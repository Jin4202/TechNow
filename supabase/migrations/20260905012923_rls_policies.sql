-- RLS 정책 (D-02)
--
-- 원칙: 모든 테이블에 RLS를 켠다. 예외 없음.
-- anon 키는 브라우저에 공개되므로 RLS가 유일한 방어선이다.
-- 파이프라인은 RLS를 우회하는 service_role 키로 쓴다 (CLAUDE.md §2.1).
--
-- 정책이 없는 테이블은 anon/authenticated 에게 0행으로 보인다.
-- 그게 seen_feed_items / source_texts / pipeline_runs 의 의도된 상태다.

-- ─────────────────────────────────────────────────────────────
-- 전 테이블 RLS 활성화
-- ─────────────────────────────────────────────────────────────

alter table profiles             enable row level security;
alter table articles             enable row level security;
alter table article_sources      enable row level security;
alter table article_translations enable row level security;
alter table scraps               enable row level security;
alter table monthly_summaries    enable row level security;
alter table seen_feed_items      enable row level security;
alter table source_texts         enable row level security;
alter table pipeline_runs        enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 공개 콘텐츠 — 발행된 기사만
-- ─────────────────────────────────────────────────────────────

-- 기사 읽기에는 로그인이 필요 없다 (기획서 §2.7).
-- draft / ready / unpublished 는 절대 새면 안 된다
create policy "발행된 기사만 공개"
  on articles for select
  to anon, authenticated
  using (status = 'published');

-- 출처와 번역본은 부모 기사가 발행됐을 때만 보인다
create policy "발행된 기사의 출처만 공개"
  on article_sources for select
  to anon, authenticated
  using (
    exists (
      select 1 from articles a
      where a.id = article_sources.article_id
        and a.status = 'published'
    )
  );

create policy "발행된 기사의 번역본만 공개"
  on article_translations for select
  to anon, authenticated
  using (
    exists (
      select 1 from articles a
      where a.id = article_translations.article_id
        and a.status = 'published'
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 사용자 소유 데이터 — 본인 것만
-- ─────────────────────────────────────────────────────────────

create policy "본인 프로필만 조회"
  on profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "본인 프로필만 수정"
  on profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- 스크랩은 로그인이 필요하다 (기획서 §2.7)
create policy "본인 스크랩만 조회"
  on scraps for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "본인 스크랩만 추가"
  on scraps for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 언제든 스크랩을 해제할 수 있다
create policy "본인 스크랩만 삭제"
  on scraps for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 요약은 파이프라인이 만든다. 사용자는 읽기만
create policy "본인 월간 요약만 조회"
  on monthly_summaries for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────
-- 파이프라인 전용 테이블 — 정책 없음 + 권한 회수
--
-- RLS만으로도 0행이지만, 기본 grant 까지 회수해 두 겹으로 막는다
-- ─────────────────────────────────────────────────────────────

revoke all on seen_feed_items from anon, authenticated;
revoke all on source_texts    from anon, authenticated;
revoke all on pipeline_runs   from anon, authenticated;

-- 앱은 기사/출처/번역본을 읽기만 한다. 쓰기는 service_role 전용
revoke insert, update, delete on articles             from anon, authenticated;
revoke insert, update, delete on article_sources      from anon, authenticated;
revoke insert, update, delete on article_translations from anon, authenticated;
revoke insert, update, delete on monthly_summaries    from anon, authenticated;

-- 프로필은 트리거가 만든다. 사용자가 직접 만들거나 지우지 않는다
revoke insert, delete on profiles from anon, authenticated;
