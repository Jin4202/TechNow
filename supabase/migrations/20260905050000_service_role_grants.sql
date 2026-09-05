-- service_role 권한을 명시적으로 부여 (D-18 보강)
--
-- 앞선 explicit_grants 마이그레이션은 anon/authenticated 만 다루고
-- service_role 은 Supabase 기본값에 기댔다. 두 환경에서 결과가 갈렸다:
--
--   로컬 스택          기본 privileges 가 살아 있어 service_role 이 전권을 받음
--   클라우드           "Automatically expose new tables" OFF 라 아무 권한도 못 받음
--
-- 그래서 로컬 라이브 테스트는 전부 통과하는데 배포된 파이프라인만
-- "permission denied for table pipeline_runs" 로 죽었다.
--
-- 교훈은 D-18 과 같다: 환경마다 다를 수 있는 기본값에 기대지 말고 전부 명시한다.
-- service_role 은 RLS 를 우회하지만(BYPASSRLS) 테이블 grant 는 따로 필요하다.

grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines  in schema public to service_role;

-- 앞으로 만들어지는 것들도 자동으로 받는다.
-- 파이프라인은 모든 테이블에 접근해야 하므로 anon/authenticated 와 달리
-- 화이트리스트로 관리하지 않는다
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on routines  to service_role;
