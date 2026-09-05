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
