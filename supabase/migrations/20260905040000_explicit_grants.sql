-- 권한을 명시적으로 만든다 (D-02 보강)
--
-- 지금까지는 Supabase 의 기본 grant 에 기대고, 필요 없는 것만 revoke 했다.
-- 두 가지 문제가 있었다:
--
--   1. 기본 grant 는 anon 에게 TRUNCATE 와 REFERENCES 까지 준다.
--      TRUNCATE 는 RLS 로 걸러지지 않는다 (PostgREST 가 노출하지 않을 뿐이다).
--   2. 새 테이블이 자동으로 노출된다. Phase 3에서 테이블을 추가하며
--      RLS 를 빠뜨리면 그대로 공개된다.
--
-- 여기서는 전부 회수한 뒤 필요한 것만 준다. 대시보드의
-- "Automatically expose new tables" 토글과 무관하게 같은 결과가 나오므로
-- 로컬 스택과 클라우드가 갈라지지 않는다.

-- ─────────────────────────────────────────────────────────────
-- 1. 전부 회수
-- ─────────────────────────────────────────────────────────────

revoke all on all tables in schema public from anon, authenticated;

-- 앞으로 만들어지는 테이블도 기본적으로 아무 권한이 없다.
-- 새 테이블은 이 파일에 grant 를 추가해야 앱에서 보인다
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. 필요한 것만 부여
--
-- RLS 정책이 "어느 행"을 정하고, grant 가 "어느 동작"을 정한다.
-- 둘 다 통과해야 접근된다
-- ─────────────────────────────────────────────────────────────

-- 공개 콘텐츠. 읽기만. 정책이 published 행으로 좁힌다
grant select on articles             to anon, authenticated;
grant select on article_sources      to anon, authenticated;
grant select on article_translations to anon, authenticated;

-- 프로필은 본인 행만. 생성은 트리거(1.3)가 하고 삭제는 계정 삭제로 cascade 된다
grant select, update on profiles to authenticated;

-- 스크랩은 본인 행만. 수정할 필드가 없으므로 update 는 주지 않는다
grant select, insert, delete on scraps to authenticated;

-- 요약은 파이프라인이 만든다. 사용자는 읽기만
grant select on monthly_summaries to authenticated;

-- seen_feed_items / source_texts / pipeline_runs 에는 아무것도 주지 않는다.
-- service_role 전용이다

-- ─────────────────────────────────────────────────────────────
-- 3. 새 테이블에 RLS 를 강제하는 이벤트 트리거
--
-- 대시보드의 "Enable automatic RLS" 와 같은 역할을 마이그레이션에 둔다.
-- 로컬 스택에도 똑같이 걸려야 운영과 갈라지지 않는다
-- ─────────────────────────────────────────────────────────────

create or replace function public.force_rls_on_new_tables()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj record;
begin
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag = 'CREATE TABLE' and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

drop event trigger if exists force_rls_on_new_tables;

create event trigger force_rls_on_new_tables
  on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function public.force_rls_on_new_tables();
