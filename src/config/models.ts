/**
 * 모델 배정.
 *
 * 모델 ID는 이 파일에만 둔다 (CLAUDE.md §2.7). 파일마다 문자열을 흩뿌리지 않는다.
 */

export const MODEL_SONNET = 'claude-sonnet-5';
/**
 * 모델 ID 에 날짜 접미사를 붙이지 않는다. 위 문자열이 완전한 형태다.
 *
 * Haiku 4.5 주의:
 *   - output_config.effort 를 지원하지 않는다 (에러). Sonnet 에만 쓴다
 *   - thinking 은 budget_tokens 방식이다. 이 파이프라인에서는 쓰지 않는다
 */
export const MODEL_HAIKU = 'claude-haiku-4-5';

/**
 * 출처 본문을 프롬프트에 싣는 단계들.
 *
 * ⚠️ 네 단계가 모두 같은 모델이어야 prompt cache 프리픽스를 공유한다 (D-06).
 * 하나라도 다른 모델로 바꾸면 그 단계는 캐시를 못 쓰고 20k 토큰짜리 출처 블록을
 * 매번 새로 지불한다. 예산($0.20/기사, D-07)이 이 공유를 전제로 잡혀 있다.
 *
 * 비용 최적화를 하더라도 여기는 건드리지 말 것.
 * tests/config.test.ts 가 이 불변식을 지킨다.
 */
export const sourceReadingModels = {
  /** 기사 작성 */
  write: MODEL_SONNET,
  /** 검증 가능한 클레임 추출 */
  extractClaims: MODEL_SONNET,
  /** 클레임을 출처 본문과 대조 */
  verifyClaims: MODEL_SONNET,
  /** 검증 실패 시 재작성 (1회) */
  rewrite: MODEL_SONNET,
} as const;

/**
 * 출처 본문을 읽지 않는 단계.
 * 캐시와 무관하므로 비용 로그를 보고 자유롭게 재배정할 수 있다.
 */
export const otherModels = {
  /** 같은 사건 묶기 + follow-up 판정 */
  group: MODEL_HAIKU,
  /** 1차 중요도 채점 (RSS 설명만 보고) */
  score: MODEL_HAIKU,
  /** 근접 재채점 (트리거 페이지 1장) */
  rescore: MODEL_HAIKU,
  /** 검색 쿼리 생성 */
  generateQueries: MODEL_HAIKU,
  /** 영문 기사 → 한국어 */
  translate: MODEL_SONNET,
  /** 월간 스크랩 요약 */
  monthlySummary: MODEL_SONNET,
} as const;

export const models = { ...sourceReadingModels, ...otherModels } as const;

export type PipelineStep = keyof typeof models;
export type ModelId = typeof MODEL_SONNET | typeof MODEL_HAIKU;

/**
 * 100만 토큰당 단가 (USD).
 *
 * 비용 로그(D-07)를 만들기 위한 값이다. 실제 청구는 Anthropic 콘솔이 기준이고,
 * 여기 값은 추정치를 계산해 예산 알림(7.5)을 걸기 위한 것이다.
 *
 * 캐시: 읽기는 입력의 0.1배, 쓰기는 1.25배.
 */
export const PRICING: Record<ModelId, { input: number; output: number }> = {
  [MODEL_SONNET]: { input: 2, output: 10 },
  [MODEL_HAIKU]: { input: 1, output: 5 },
};

/**
 * 단계별 effort (Sonnet 전용 — Haiku 4.5 는 effort 를 지원하지 않는다).
 *
 * 실측: 작성 단계에서 high 는 사고 토큰을 2배 쓰는데 결과물은 medium 과
 * 구분되지 않았다 (단어 수 879 vs 820, 긴 문장 16 vs 16). 기사당 $0.023 차이.
 *
 * 다만 낮은 effort 가 근거 오류를 늘리면 grounding 검증이 재작성을 유발해
 * 오히려 비싸질 수 있다. 검증 단계는 마지막 방어선이라 high 로 둔다.
 * 재작성 비율은 3.17 에서 확인하고 조정한다.
 */
export const EFFORT = {
  write: 'medium',
  rewrite: 'medium',
  extractClaims: 'medium',
  verifyClaims: 'high',
  translate: 'medium',
  monthlySummary: 'medium',
} as const;

export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;
