-- 토픽 종류를 기록한다 (로드맵 8.3, D-57)
--
-- 후보 풀의 66% 가 논문 보도자료 재게시처(ScienceDaily, phys.org)인데
-- novelty 앵커가 "A paper ... made public today" 를 5점으로 정의해서
-- 임계 통과에서는 63% 로 더 쏠렸다. 사용자가 "사실상 논문을 그대로 요약해놓은
-- 기사" 를 문제로 지목했다.
--
-- 채점이 종류를 판정하고, 선정이 "하루 N건 중 논문은 최대 M건" 쿼터를 건다.
-- 여기 남기는 이유는 **얼마나 자주 쿼터가 물리는지, 실제로 무엇이 발행됐는지**
-- 를 나중에 확인해야 하기 때문이다 — 로그는 하루만 남고 DB 가 기록의 원본이다.
alter table run_topics
  add column topic_kind text check (topic_kind in ('paper', 'event', 'product', 'trend'));

comment on column run_topics.topic_kind is
  '토픽 종류. 점수가 아니라 구성 쿼터를 위한 것이다 (D-57)';

-- 쿼터가 무는 빈도를 보려면 사유별 조회가 필요하다.
-- reject_reason 에 paper-quota 가 들어간다
create index run_topics_kind_idx on run_topics (topic_kind)
  where topic_kind is not null;
