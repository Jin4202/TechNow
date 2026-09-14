-- 발행 프로필 (로드맵 7.9b, D-61)
--
-- 하루 발행량을 프로필(two: 2편 / one: 1편)로 고른다. 2편 프로필은 두 기사의 분야가
-- 겹치지 않게 하는데, 분야는 원래 작성 단계에서야 정해져서 선정 때는 알 수 없었다.
-- 그래서 채점이 분야를 예측하게 했다.

-- 채점이 예측한 분야. articles.category(작성이 정한 실제 분야)와 대조하면
-- 예측이 얼마나 맞는지 잴 수 있다 — 틀리는 만큼 분야 겹침 금지가 샌다.
-- 값 목록을 check 로 박지 않는다. 분야 목록의 원본은 src/config/categories.ts 다
alter table run_topics
  add column topic_category text;

comment on column run_topics.topic_category is
  '채점이 예측한 분야 (D-61). 실제 분야는 articles.category';

-- 이 런이 쓴 프로필. 전환한 날의 비용과 편수를 나중에 가를 수 있어야 한다 —
-- 로그는 하루만 남고 DB 가 기록의 원본이다 (CLAUDE.md §4).
-- 프로필 이전의 런은 null 로 남는다
alter table pipeline_runs
  add column profile text check (profile in ('two', 'one'));

comment on column pipeline_runs.profile is
  '이 런이 쓴 발행 프로필 (D-61). 프로필 도입 이전 런은 null';
