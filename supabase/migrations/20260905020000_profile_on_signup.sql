-- 가입 시 profile 자동 생성 (로드맵 1.3)
--
-- 앱에서 만들지 않고 트리거로 만드는 이유:
--   - profiles 는 anon/authenticated 에게 insert 권한이 없다 (D-02).
--     사용자가 임의로 행을 만들거나 남의 id 로 만들 수 없어야 한다
--   - 가입 직후 프로필이 없는 순간이 생기면 locale 조회가 매번 분기해야 한다

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
-- search_path 를 비워 스키마 하이재킹을 막는다. 모든 참조를 정규화한다
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    -- 가입 폼에 표시 이름이 없으므로 이메일 로컬 파트를 기본값으로 둔다.
    -- 사용자가 프로필 페이지에서 바꿀 수 있다 (4.2)
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- 트리거 이전에 가입한 계정 백필
insert into public.profiles (id, display_name)
select u.id, split_part(u.email, '@', 1)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
