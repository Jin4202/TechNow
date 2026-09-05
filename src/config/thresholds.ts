/**
 * 토픽 선정 튜닝 값.
 *
 * 배포 없이 바꿀 수 있어야 한다 (CLAUDE.md §2.4, 로드맵 2.6).
 * 값의 근거는 docs/DECISIONS.md 와 docs/MASTER_PLAN.md §9.
 */
export const thresholds = {
  /** 통과 최소 총점. 15점 만점 (3축 × 5점) */
  total: 10,

  /**
   * 모든 축이 이 값 이상이어야 통과.
   * 기획서의 "어느 축도 2 이하가 아님"을 양성 표현으로 통일한 것 (D-09).
   * 선정 규칙 전체: total >= 10 && min(axis) >= 3
   */
  minAxis: 3,

  /** 하루 발행 상한. 비용 가드 */
  dailyCap: 3,

  /**
   * 재채점 대상 수 — 1차 점수 상위 몇 개까지 원문을 가져와 다시 볼 것인가 (D-19).
   *
   * 기획서의 "임계선 ±2" 밴드 방식을 대체했다. 밴드는 점수 분포에 따라
   * 대상 수가 요동친다 — 실측에서 총점 중앙값 9에 임계값 10이라
   * 밴드가 134개 중 72개를 삼켰고 월 $8.21 이 나왔다.
   *
   * 상한이 3인 이상 실제 판단이 필요한 건 상위 몇 개뿐이다.
   * 20등 토픽의 점수가 9인지 10인지는 아무 결과도 바꾸지 않는다.
   *
   * 상한의 3배로 둔다 — 재채점이 점수를 낮출 수 있으므로 여유를 둔다
   */
  rescoreTopN: 9,

  /** 그룹핑 프롬프트에 넣을 "최근 발행 기사 제목"의 기간 */
  followUpWindowDays: 7,

  /**
   * seen_feed_items 가 pending 으로 남아 있을 수 있는 최대 일수 (D-01).
   * 이보다 오래된 pending 은 폐기한다. 뉴스로서 이미 식었다고 본다
   */
  pendingTtlDays: 3,

  /**
   * processed 행 보존 기간 (D-01).
   * 재게시되는 피드 항목을 계속 걸러야 하므로 followUpWindowDays 보다 훨씬 길다
   */
  processedRetentionDays: 90,

  /**
   * 한 번의 채점 호출에 넣는 토픽 수.
   *
   * 130개를 한 번에 보내면 뒤쪽 토픽의 채점이 성의없어진다.
   * 작게 자르면 호출 수와 시스템 프롬프트 중복이 늘어난다
   */
  scoringChunkSize: 20,

  /** 채점 호출 동시 실행 수. 레이트 리밋과 지연 사이의 절충 */
  scoringConcurrency: 4,
} as const;

export type Thresholds = typeof thresholds;
