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

  /**
   * 월 총예산 (USD). 모든 외부 API 합산.
   *
   * 20 → 25 (2026-09-05). Phase 3 실측이 이미 $24.4 였고 Phase 4 의 번역이
   * 편당 $0.046 을 더했다. 사용자 판단으로 예산 쪽을 올렸다 (D-36).
   */
  monthlyUsd: 25,

  /**
   * 기사당 변동비 **목표** (USD). 실측이 아니다.
   *
   * 고정비(발굴~선정)는 여기 포함되지 않는다 (D-07).
   * 예산 계산식: cost_fixed × 30 + cost_variable × 기사 수 <= monthlyUsd
   *
   * ⚠️ 실측은 이 목표를 넘는다 — 조사·작성 $0.218 + 번역 $0.046 = 편당 $0.264
   * (2026-09-05, 표본 1런). 목표를 실측에 맞춰 올리지 않는 이유는 그러면
   * 이 값이 신호이기를 그만두기 때문이다. 차이는 D-36 에 적혀 있다.
   */
  variableUsdPerArticle: 0.2,

  /** 월 누적 비용이 예산의 이 비율을 넘으면 알림 (로드맵 7.5) */
  alertRatio: 0.8,

  /** source_texts 보존 기간. 조사~검증 단계가 공유하는 임시 저장소 (D-05) */
  sourceTextTtlDays: 7,
} as const;

export type Budget = typeof budget;
