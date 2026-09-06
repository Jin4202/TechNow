-- Rate limiting (로드맵 7.2)
--
-- Vercel 서버리스는 인스턴스가 계속 바뀌므로 메모리 카운터가 의미가 없다.
-- 이미 쓰고 있는 DB 에 고정 윈도우 카운터를 둔다. 지금 트래픽에서 부하는
-- 무시할 만하고, 공급자를 하나 더 늘리지 않는다.

create table rate_limits (
  -- 무엇을 제한하는가 (auth / scrap) + 누구인가 (IP 또는 user id)
  bucket text not null,
  identifier text not null,
  -- 고정 윈도우의 시작. 슬라이딩 윈도우를 쓰지 않는 이유는 행이 하나로 유지되기
  -- 때문이다 — 슬라이딩은 요청마다 행이 쌓이고 그만큼 정리 부담이 생긴다
  window_start timestamptz not null,
  count integer not null default 0,

  primary key (bucket, identifier, window_start)
);

-- 오래된 윈도우 정리용 (일간 런의 정리 단계가 쓴다)
create index rate_limits_window_start_idx on rate_limits (window_start);

-- ─────────────────────────────────────────────────────────────
-- 판정 함수
--
-- security definer 다. 앱은 anon 키로 도는데 이 테이블에는 권한이 없다 —
-- 카운터를 직접 읽거나 쓰게 두면 공격자가 자기 카운터를 지울 수 있다.
-- 함수만 열고 테이블은 닫는다.
-- ─────────────────────────────────────────────────────────────

create or replace function check_rate_limit(
  p_bucket text,
  p_identifier text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  -- 윈도우 시작을 초 단위로 내림한다. 같은 윈도우의 요청은 같은 행에 모인다
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into rate_limits (bucket, identifier, window_start, count)
  values (p_bucket, p_identifier, v_window_start, 1)
  on conflict (bucket, identifier, window_start)
    do update set count = rate_limits.count + 1
  returning count into v_count;

  -- true = 허용. 상한을 넘긴 요청 자체도 세어 둔다 —
  -- 계속 두드리는 것이 로그에 남아야 한다
  return v_count <= p_max;
end;
$$;

-- 함수만 실행할 수 있다. 테이블 권한은 주지 않는다
grant execute on function check_rate_limit(text, text, integer, integer) to anon, authenticated;

alter table rate_limits enable row level security;
-- 정책을 두지 않는다. security definer 함수만 이 테이블을 만진다
