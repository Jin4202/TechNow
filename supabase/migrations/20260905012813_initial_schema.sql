-- TechNow 초기 스키마
--
-- 근거: docs/ARCHITECTURE.md §4, docs/DECISIONS.md D-01 ~ D-03, D-05, D-07, D-15
--
-- 원칙: 모든 테이블에 RLS를 켠다. 예외 없음 (D-02).
-- 파이프라인은 RLS를 우회하는 service_role 키로 쓰고, 앱은 anon 키로만 읽는다.

-- ─────────────────────────────────────────────────────────────
-- ENUM
-- ─────────────────────────────────────────────────────────────

-- D-15. kebab-case 하나로 DB enum 값과 URL 슬러그를 겸한다
create type category as enum (
  'ai-computing',
  'space-astronomy',
  'health-biotech',
  'climate-energy',
  'physics-materials',
  'robotics-hardware',
  'industry-policy'
);

create type locale as enum ('en', 'ko');

-- draft         토픽 선정됨, 작업 중
-- ready_pending 영문 본문 완료, 나머지 자산 대기
-- ready         필수 자산 전부 완료. 다음 07:00 발행 대상
-- published     발행됨. 이후 수정하지 않는다
-- failed        2회 연속 hold-back 등으로 포기
-- unpublished   오류로 내림. 삭제하지 않는다
create type article_status as enum (
  'draft', 'ready_pending', 'ready', 'published', 'failed', 'unpublished'
);

-- D-01. pending 은 아직 선정 단계를 통과해 본 적 없는 항목.
-- 다음 런의 후보에 다시 포함된다. 탈락한 항목도 processed 다.
create type feed_item_status as enum ('pending', 'processed');

create type run_type as enum ('daily', 'monthly');
create type run_status as enum ('running', 'success', 'failed');

-- ─────────────────────────────────────────────────────────────
-- pipeline_runs
-- Trigger.dev 무료 티어는 로그를 하루만 보관한다. 기록의 원본은 로그가 아니라 이 테이블
-- ─────────────────────────────────────────────────────────────

create table pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  run_type run_type not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status run_status not null default 'running',

  topics_seen integer not null default 0,
  topics_selected integer not null default 0,
  articles_published integer not null default 0,

  cost_search_calls integer not null default 0,
  cost_pages_fetched integer not null default 0,
  cost_images integer not null default 0,
  cost_input_tokens bigint not null default 0,
  cost_output_tokens bigint not null default 0,
  cost_cached_tokens bigint not null default 0,

  -- D-07. 발굴~선정은 기사가 0개인 날에도 발생하는 고정비다.
  -- 전체를 기사 수로 나누면 조용한 날 단가가 왜곡된다.
  -- 예산 계산식: cost_fixed × 30 + cost_variable × 기사 수 <= 20 USD
  cost_fixed numeric(10, 4) not null default 0,
  cost_variable numeric(10, 4) not null default 0,

  notes text
);

create index pipeline_runs_started_at_idx on pipeline_runs (started_at desc);

-- ─────────────────────────────────────────────────────────────
-- profiles
-- ─────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale locale not null default 'en',
  -- 6.8. 기본 on. 나중에 마이그레이션 없이 유료화할 수 있도록 처음부터 둔다
  premium boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- seen_feed_items  (D-01)
-- ─────────────────────────────────────────────────────────────

create table seen_feed_items (
  url_hash text primary key,
  feed_name text not null,
  first_seen_on date not null default (now() at time zone 'utc')::date,
  run_id uuid references pipeline_runs (id) on delete set null,
  status feed_item_status not null default 'pending',
  processed_at timestamptz,

  -- processed 인데 시각이 없거나, pending 인데 시각이 있으면 상태 전이가 깨진 것
  constraint seen_feed_items_processed_at_matches_status check (
    (status = 'processed' and processed_at is not null)
    or (status = 'pending' and processed_at is null)
  )
);

-- 매 런의 첫 질의: 아직 처리되지 않은 항목 가져오기
create index seen_feed_items_pending_idx
  on seen_feed_items (first_seen_on)
  where status = 'pending';

-- TTL 정리용 (pending 3일, processed 90일)
create index seen_feed_items_first_seen_on_idx on seen_feed_items (first_seen_on);

-- ─────────────────────────────────────────────────────────────
-- articles
-- ─────────────────────────────────────────────────────────────

create table articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  category category not null,
  tags text[] not null default '{}',

  score_novelty smallint check (score_novelty between 1 and 5),
  score_impact smallint check (score_impact between 1 and 5),
  score_interest smallint check (score_interest between 1 and 5),
  importance_score smallint check (importance_score between 3 and 15),

  -- 멱등성 키. (run_id, topic_hash) 로 재시도 시 중복 생성을 막는다
  run_id uuid references pipeline_runs (id) on delete set null,
  topic_hash text not null,

  follow_up_of uuid references articles (id) on delete set null,

  title text not null,
  one_line_summary text not null,

  -- D-03. { "sections": [{ heading, paragraphs[], sources[] }] }
  -- sources 는 article_sources.ordinal 을 가리킨다
  body jsonb not null,

  cover_image_url text,
  status article_status not null default 'draft',

  -- 2회 도달 시 failed 처리 + 알림. 식은 뉴스를 늦게 내보내지 않는다
  held_back_count smallint not null default 0,

  style_guide_version text,
  published_at timestamptz,
  created_at timestamptz not null default now(),

  -- coalesce 필수: sections 키가 없으면 jsonb_typeof 가 NULL 을 돌려주고,
  -- check 제약은 NULL 을 통과로 취급한다
  constraint articles_body_has_sections check (
    coalesce(jsonb_typeof(body -> 'sections') = 'array', false)
  ),
  constraint articles_no_self_follow_up check (follow_up_of is null or follow_up_of <> id),
  constraint articles_published_has_timestamp check (
    status <> 'published' or published_at is not null
  )
);

-- 재시도가 기사를 중복 생성하지 않도록
create unique index articles_run_topic_idx on articles (run_id, topic_hash)
  where run_id is not null;

-- 목록 페이지의 주 질의
create index articles_published_idx on articles (published_at desc)
  where status = 'published';

-- 7.3 카테고리 필터
create index articles_category_idx on articles (category, published_at desc)
  where status = 'published';

-- 2.3 최근 7일 발행 제목을 그룹핑 프롬프트에 넣을 때
create index articles_status_idx on articles (status);

create index articles_follow_up_of_idx on articles (follow_up_of)
  where follow_up_of is not null;

-- ─────────────────────────────────────────────────────────────
-- article_sources  (D-03)
-- ─────────────────────────────────────────────────────────────

create table article_sources (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles (id) on delete cascade,
  -- body 의 sections[].sources 가 이 번호를 가리킨다. 1부터
  ordinal smallint not null check (ordinal >= 1),
  url text not null,
  title text,
  publisher text,
  -- 1: 논문·공식발표·보도자료  2: 기명 보도를 하는 주요 언론
  tier smallint not null check (tier in (1, 2)),
  fetched_at timestamptz not null default now(),

  unique (article_id, ordinal)
);

create index article_sources_article_id_idx on article_sources (article_id);

-- ─────────────────────────────────────────────────────────────
-- article_translations  (D-03)
-- ─────────────────────────────────────────────────────────────

create table article_translations (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles (id) on delete cascade,
  locale locale not null,
  title text not null,
  one_line_summary text not null,
  -- 원문과 동일한 구조. sections 수와 각 섹션의 sources 배열이 일치해야 한다.
  -- 정합성 검증은 코드에서 한다 (4.3a)
  body jsonb not null,
  created_at timestamptz not null default now(),

  unique (article_id, locale),
  constraint article_translations_body_has_sections
    check (coalesce(jsonb_typeof(body -> 'sections') = 'array', false))
);

-- ─────────────────────────────────────────────────────────────
-- source_texts  (D-05)
-- 조사~검증 단계가 공유하는 임시 저장소. 영구 보관하지 않는다
-- ─────────────────────────────────────────────────────────────

create table source_texts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references pipeline_runs (id) on delete cascade,
  topic_hash text not null,
  article_id uuid references articles (id) on delete cascade,
  url text not null,
  extracted_text text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- 작성·추출·검증 단계의 조회 경로
create index source_texts_run_topic_idx on source_texts (run_id, topic_hash);

-- 매 런 종료 시 만료분 삭제
create index source_texts_expires_at_idx on source_texts (expires_at);

-- ─────────────────────────────────────────────────────────────
-- scraps
-- ─────────────────────────────────────────────────────────────

create table scraps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  article_id uuid not null references articles (id) on delete cascade,
  scraped_at timestamptz not null default now(),

  unique (user_id, article_id)
);

create index scraps_user_id_idx on scraps (user_id, scraped_at desc);

-- ─────────────────────────────────────────────────────────────
-- monthly_summaries
-- ─────────────────────────────────────────────────────────────

create table monthly_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  month_start date not null,
  locale locale not null,
  summary_text text not null,
  article_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),

  unique (user_id, month_start, locale)
);

create index monthly_summaries_user_id_idx on monthly_summaries (user_id, month_start desc);
