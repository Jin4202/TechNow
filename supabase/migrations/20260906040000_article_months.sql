-- 월별 아카이브의 월 목록 (로드맵 7.8)
--
-- PostgREST 는 group by 를 못 한다. 함수로 둔다 (rate limit 판정과 같은 방식, D-44).

-- **security definer 를 쓰지 않는다.** 기본(invoker)이라야 호출자의 RLS 가 그대로
-- 걸려서 발행된 기사만 세어진다. definer 로 만들면 draft 까지 세어지고,
-- 편수만 보고도 발행 전 기사가 몇 건인지 알 수 있게 된다.
create function article_months()
returns table (month date, article_count bigint)
language sql
stable
set search_path = public
as $$
  -- 월 경계는 America/Los_Angeles 다. 발행이 07:00 PT 로 도는 이상(D-04)
  -- 독자가 보는 "9월 기사" 는 PT 기준이어야 한다.
  -- (월간 요약의 UTC 경계와 다르다 — 그쪽은 사용자별 집계라 목적이 다르다)
  select
    date_trunc('month', published_at at time zone 'America/Los_Angeles')::date as month,
    count(*) as article_count
  from articles
  where status = 'published' and published_at is not null
  group by 1
  order by 1 desc;
$$;

grant execute on function article_months() to anon, authenticated;
