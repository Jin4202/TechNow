-- 기사 생성 실패를 선정 탈락과 분리한다 (7.x 비용 분석 중 발견)
--
-- 지금까지는 생성 실패를 `reject_reason = 'build:grounding-failed'` 로 적고
-- `selected = false` 로 뒀다. 두 가지가 틀렸다:
--
--   1. 선정된 토픽이다. 조사·작성·검증까지 갔고 돈을 다 썼다.
--      `selected = false` 로 두면 "선정 3건" 으로 세어져 실제 시도 횟수가 사라진다
--   2. 실패 상세("근거 없음 1건", "섹션 4")가 어디에도 안 남는다.
--      근거 없는 진술이 1건인지 5건인지는 완전히 다른 문제인데 구분할 수 없다

alter table run_topics
  add column build_failure text,
  add column build_detail text;

-- 선정됐지만 기사가 안 나온 행을 표현할 수 있어야 한다.
-- 기존 제약은 `selected` 면 `reject_reason` 이 null 이어야 한다는 것이고,
-- 생성 실패는 이제 별도 컬럼에 들어가므로 그 제약과 충돌하지 않는다.
comment on column run_topics.build_failure is
  '기사 생성 실패 종류 (research-failed / grounding-failed / write-failed 등). 선정됐으나 기사가 안 나온 경우에만.';
comment on column run_topics.build_detail is
  '실패 상세. 예: "근거 없음 1건", "섹션 4".';

-- 실패 원인별 집계용
create index run_topics_build_failure_idx on run_topics (build_failure)
  where build_failure is not null;
