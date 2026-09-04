/**
 * RSS 피드 목록.
 *
 * TODO(1.5): 3~5개 피드를 선정해 채운다.
 * 조건 — 영어 피드, 7개 카테고리를 모두 커버, 과학과 기술이 대략 균등.
 * 선정 결과는 docs/DECISIONS.md 에 기록한다.
 */
export interface Feed {
  /** 로그와 seen_feed_items.feed_name 에 쓰는 식별자 */
  name: string;
  url: string;
  /** 이 피드가 주로 커버하는 카테고리 (커버리지 확인용, 분류에 쓰지 않음) */
  covers: readonly string[];
}

export const feeds: readonly Feed[] = [] as const;
