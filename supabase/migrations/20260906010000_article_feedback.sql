-- 독자 피드백 "이해하기 쉬웠나요?" (D-28, 로드맵 3.14a)
--
-- 이해 가능성을 합성 판정기가 아니라 실제 독자에게서 받는다.
-- 누적되면 프롬프트·스타일 변경의 전후 비교에 쓸 수 있다.

create table article_feedback (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles (id) on delete cascade,
  helpful boolean not null,

  -- 브라우저가 만든 익명 키. localStorage 에 보관한다.
  -- 로그인을 요구하지 않는 이유: 기사 읽기에 로그인이 필요 없으므로(기획서 §2.7)
  -- 투표에만 요구하면 신호가 대부분 사라진다.
  -- 완벽한 중복 방지는 아니지만 내부 품질 지표라 남용 방어보다 신호 확보가 우선이다
  voter_key text not null,

  -- 어느 언어로 읽고 눌렀는지.
  -- 한국어 번역이 원문보다 이해하기 어려우면 그것이 지표에 드러나야 한다 —
  -- D-03 의 구조 일치 검증만으로는 알 수 없다
  locale locale not null,

  -- 투표 시점의 기사 버전. articles 에서 조인해도 되지만 고정해 둔다
  style_guide_version text,

  created_at timestamptz not null default now(),

  unique (article_id, voter_key)
);

create index article_feedback_article_id_idx on article_feedback (article_id);
create index article_feedback_created_at_idx on article_feedback (created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 권한 (D-02, D-18)
--
-- 새 테이블은 default privileges 에 따라 anon/authenticated 가 아무 권한도 받지
-- 않고, 이벤트 트리거가 RLS 를 자동으로 켠다. 여기서 insert 만 명시적으로 연다.
-- ─────────────────────────────────────────────────────────────

grant insert on article_feedback to anon, authenticated;

-- **select 는 주지 않는다.** 집계를 독자에게 보여주면 남의 판단이 보여
-- 지표가 편향된다. 집계는 service_role 로 읽는다
create policy "발행된 기사에만 투표할 수 있다"
  on article_feedback for insert
  to anon, authenticated
  with check (
    exists (
      select 1 from articles a
      where a.id = article_feedback.article_id
        and a.status = 'published'
    )
  );
