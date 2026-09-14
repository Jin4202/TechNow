import { activeProfile } from './profiles';
import { envInt, envNumber } from './tunables';

/**
 * 토픽 선정 튜닝 값.
 *
 * 아래는 기본값이고, 각 항목은 환경변수로 덮어쓸 수 있다 (로드맵 2.6).
 * Trigger.dev 환경변수는 재배포 없이 바뀌므로 캘리브레이션(2.8) 중에
 * 배포를 기다리지 않아도 된다.
 *
 * 값의 근거는 docs/DECISIONS.md 와 docs/MASTER_PLAN.md §9.
 *
 * getter 로 둔 것은 의도적이다 — 모듈 로드 시 한 번 읽으면 같은 워커가
 * 살아 있는 동안 환경변수 변경이 반영되지 않는다.
 */
export const thresholds = {
  /** 통과 최소 총점. 15점 만점 (3축 × 5점). env: TECHNOW_THRESHOLD_TOTAL */
  get total() {
    return envInt('TECHNOW_THRESHOLD_TOTAL', 10);
  },

  /**
   * 모든 축이 이 값 이상이어야 통과.
   * 기획서의 "어느 축도 2 이하가 아님"을 양성 표현으로 통일한 것 (D-09).
   * 선정 규칙 전체: total >= 10 && min(axis) >= 3
   * env: TECHNOW_MIN_AXIS
   */
  get minAxis() {
    return envInt('TECHNOW_MIN_AXIS', 3);
  },

  /**
   * 하루 발행 상한. **발행 프로필이 정한다** (D-61).
   *
   * 개별 환경변수로 따로 덮지 않는다 — 상한·논문 규칙·분야 규칙이 서로를 전제하므로
   * 묶음(`TECHNOW_PROFILE`) 단위로만 고른다. 도달 목표가 아니라 천장이다.
   *
   * 역사: 3 → 5 (D-46) → 프로필 two 2 · one 1 (2026-09-14, D-61)
   */
  get dailyCap() {
    return activeProfile().dailyCap;
  },

  /**
   * 재채점 대상 수 — 1차 점수 상위 몇 개까지 원문을 가져와 다시 볼 것인가 (D-19).
   *
   * 기획서의 "임계선 ±2" 밴드 방식을 대체했다. 밴드는 점수 분포에 따라
   * 대상 수가 요동친다 — 실측에서 총점 중앙값 9에 임계값 10이라
   * 밴드가 134개 중 72개를 삼켰고 월 $8.21 이 나왔다.
   *
   * **상한의 3배**이고 프로필이 정한다 (two 6 · one 3). 재채점이 점수를 낮출 수
   * 있으므로 여유를 둔다. 역사: 9 → 15 (D-46) → 프로필 (D-61)
   *
   * 논문 규칙(예전 `maxPapersPerDay`)은 여기 없다. 프로필의 `papers` 가 갖는다
   */
  get rescoreTopN() {
    return activeProfile().rescoreTopN;
  },

  /** 그룹핑 프롬프트에 넣을 "최근 발행 기사 제목"의 기간. env: TECHNOW_FOLLOW_UP_WINDOW_DAYS */
  get followUpWindowDays() {
    return envInt('TECHNOW_FOLLOW_UP_WINDOW_DAYS', 7);
  },

  /**
   * seen_feed_items 가 pending 으로 남아 있을 수 있는 최대 일수 (D-01).
   * 이보다 오래된 pending 은 폐기한다. 뉴스로서 이미 식었다고 본다.
   * env: TECHNOW_PENDING_TTL_DAYS
   */
  get pendingTtlDays() {
    return envInt('TECHNOW_PENDING_TTL_DAYS', 3);
  },

  /**
   * processed 행 보존 기간 (D-01).
   * 재게시되는 피드 항목을 계속 걸러야 하므로 followUpWindowDays 보다 훨씬 길다
   */
  get processedRetentionDays() {
    return envInt('TECHNOW_PROCESSED_RETENTION_DAYS', 90);
  },

  /**
   * 한 번의 채점 호출에 넣는 토픽 수.
   *
   * 130개를 한 번에 보내면 뒤쪽 토픽의 채점이 성의없어진다.
   * 작게 자르면 호출 수와 시스템 프롬프트 중복이 늘어난다
   */
  scoringChunkSize: 20,

  /** 채점 호출 동시 실행 수. 레이트 리밋과 지연 사이의 절충 */
  scoringConcurrency: 4,

  /**
   * 근거 검증에 실패했을 때 **기사 전체를 다시 쓸지, 지적된 문장만 고칠지**.
   *
   * 기본은 지적된 문장만 고치는 쪽(false)이다. 전체 재작성은 비싸고
   * (출력 토큰이 변동비의 68%), 이미 통과한 문장까지 다시 굴려 새로 깨뜨린다.
   *
   * env 로 둔 이유는 **비교 측정을 위해서다** — 같은 fixture 로 양쪽을 돌려
   * 통과율과 비용을 재고 나서 판단한다 (D-27 의 교훈: 추측으로 바꾸지 않는다).
   * env: TECHNOW_FULL_REWRITE
   */
  get fullRewriteOnGroundingFailure() {
    return process.env.TECHNOW_FULL_REWRITE === '1';
  },

  /**
   * 번역본이 한국어인지 판정하는 최소 한글 비율 (4.3a).
   *
   * 구조 검증만으로는 모델이 영문을 그대로 돌려주는 실패를 못 잡는다 —
   * 구조는 완벽히 일치하고 내용만 번역되지 않은 채로 통과한다.
   *
   * 0.5 인 이유: 고유명사(기관·장비·인명)와 용어 병기는 영문으로 남는 것이 정상이라
   * 정상적인 번역도 100% 가 되지 않는다. 실측으로 조정할 값이라 env 로 뺀다.
   * env: TECHNOW_MIN_HANGUL_RATIO
   */
  get minHangulRatio() {
    return envNumber('TECHNOW_MIN_HANGUL_RATIO', 0.5);
  },
};

export type Thresholds = typeof thresholds;
