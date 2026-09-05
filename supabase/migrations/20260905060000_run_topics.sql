-- 런별 토픽 판정 기록 (로드맵 2.7)
--
-- pipeline_runs.notes 로는 부족하다. 캘리브레이션(2.8)에서
-- "지난주에 12~13점이었던 토픽들을 보여줘" 같은 질의를 해야 한다.
--
-- 하루 130여 행 × 30일 = 월 4천 행. 작다.
--
-- 파이프라인 전용 테이블이다. explicit_grants 의 default privileges 에 따라
-- anon/authenticated 는 아무 권한도 받지 않고, service_role 은 전권을 받는다.
-- RLS 는 force_rls_on_new_tables 이벤트 트리거가 자동으로 켠다 (D-18).

create table run_topics (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references pipeline_runs (id) on delete cascade,

  -- 그룹핑 결과
  topic_title text not null,
  item_count smallint not null,
  feed_names text[] not null default '{}',
  -- 이 토픽을 촉발한 항목의 URL. 재채점이 가져온 페이지이기도 하다
  trigger_url text,

  -- follow-up 판정 (2.3)
  follow_up_of uuid references articles (id) on delete set null,

  -- 1차 채점 (2.4)
  score_novelty smallint check (score_novelty between 1 and 5),
  score_impact smallint check (score_impact between 1 and 5),
  score_interest smallint check (score_interest between 1 and 5),
  importance_score smallint check (importance_score between 3 and 15),
  reason_novelty text,
  reason_impact text,
  reason_interest text,

  -- 재채점 (2.5). 재채점된 토픽은 위 점수가 재채점 결과이고
  -- first_pass_score 에 1차 총점이 남는다
  rescored boolean not null default false,
  first_pass_score smallint check (first_pass_score between 3 and 15),
  rescore_skip_reason text,

  -- 선정 (2.6)
  selected boolean not null default false,
  -- below-total | below-axis | over-cap | unscored. 통과·선정되면 null
  reject_reason text,
  -- 통과한 것들 중 순위. 1부터. 탈락은 null
  rank smallint,

  -- 실제로 기사가 만들어졌으면
  article_id uuid references articles (id) on delete set null,

  created_at timestamptz not null default now(),

  constraint run_topics_selected_has_no_reject check (
    (selected and reject_reason is null) or not selected
  ),
  constraint run_topics_rescored_has_first_pass check (
    not rescored or first_pass_score is not null
  )
);

-- 캘리브레이션의 주 질의: 특정 기간의 점수 분포
create index run_topics_run_id_idx on run_topics (run_id);
create index run_topics_score_idx on run_topics (importance_score desc);
create index run_topics_created_at_idx on run_topics (created_at desc);

-- "왜 이 토픽이 떨어졌나" 를 사유별로 집계할 때
create index run_topics_reject_reason_idx on run_topics (reject_reason)
  where reject_reason is not null;
