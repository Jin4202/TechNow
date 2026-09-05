import Anthropic from '@anthropic-ai/sdk';

/**
 * Claude API 클라이언트.
 *
 * 파이프라인 전용이다. 앱에서 부르지 않는다 (CLAUDE.md §2.1).
 * 모델 ID 는 여기서 정하지 않는다 — `src/config/models.ts` 참고.
 */

let cached: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  if (!cached) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY 가 필요합니다. Trigger.dev 환경변수를 확인하세요.');
    }
    cached = new Anthropic({ apiKey });
  }
  return cached;
}

export type AnthropicClient = Anthropic;

/** 호출 비용을 pipeline_runs 에 누적하기 위한 사용량 (D-07) */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

export function readUsage(usage: Anthropic.Usage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

/** 사용량을 USD 추정치로 바꾼다 (D-07 의 비용 로그용) */
export function estimateCost(
  usage: TokenUsage,
  pricing: { input: number; output: number },
  multipliers: { cacheRead: number; cacheWrite: number },
): number {
  const perToken = (rate: number) => rate / 1_000_000;
  return (
    usage.inputTokens * perToken(pricing.input) +
    usage.outputTokens * perToken(pricing.output) +
    usage.cacheReadTokens * perToken(pricing.input) * multipliers.cacheRead +
    usage.cacheCreationTokens * perToken(pricing.input) * multipliers.cacheWrite
  );
}
