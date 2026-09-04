/**
 * 비용 상한과 예산.
 *
 * 상한은 프롬프트로 부탁하는 게 아니라 호출 지점에서 카운터로 강제한다
 * (CLAUDE.md §2.6).
 */
export const budget = {
  /** 토픽당 검색 API 호출 상한 */
  searchCallsPerTopic: 3,

  /** 토픽당 페이지 fetch 상한 */
  pagesPerTopic: 10,

  /** 기사당 이미지 수 */
  imagesPerArticle: 1,

  /** 기사에 필요한 최소/최대 출처 수 */
  minSources: 3,
  maxSources: 5,

  /** 월 총예산 (USD). 모든 외부 API 합산 */
  monthlyUsd: 20,

  /**
   * 기사당 변동비 목표 (USD).
   *
   * 고정비(발굴~선정)는 여기 포함되지 않는다 (D-07).
   * 예산 계산식: cost_fixed × 30 + cost_variable × 기사 수 <= monthlyUsd
   */
  variableUsdPerArticle: 0.2,

  /** 월 누적 비용이 예산의 이 비율을 넘으면 알림 (로드맵 7.5) */
  alertRatio: 0.8,

  /** source_texts 보존 기간. 조사~검증 단계가 공유하는 임시 저장소 (D-05) */
  sourceTextTtlDays: 7,
} as const;

export type Budget = typeof budget;
