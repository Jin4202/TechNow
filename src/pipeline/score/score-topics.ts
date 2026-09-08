import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import {
  addUsage,
  readUsage,
  ZERO_USAGE,
  type AnthropicClient,
  type TokenUsage,
} from '@/clients/anthropic';
import { models } from '@/config/models';
import { thresholds } from '@/config/thresholds';
import {
  buildScoringPrompt,
  SCORING_SYSTEM,
  ScoringResultSchema,
  type ScoringTopicInput,
  type TopicScore,
} from '@/prompts/score-topics';

/**
 * 1차 중요도 채점 (로드맵 2.4).
 *
 * 토픽을 청크로 나눠 병렬 호출한다. 전부 한 번에 보내면 뒤쪽 채점이 성의없어지고,
 * 하나씩 보내면 호출 수와 시스템 프롬프트 중복이 늘어난다.
 *
 * 채점에 실패한 토픽은 **버리지 않는다.** 점수 없이 남겨두고 호출자가 처리한다 —
 * 조용히 사라지면 그 토픽은 영영 후보가 되지 못한다.
 */

export interface AxisScore {
  score: number;
  reason: string;
}

export interface ScoredTopic {
  /** 입력 배열에서의 인덱스 */
  index: number;
  novelty: AxisScore;
  impact: AxisScore;
  interest: AxisScore;
  /** 세 축의 합 (3~15) */
  total: number;
}

export interface ScoreTopicsResult {
  scored: ScoredTopic[];
  /** 채점을 받지 못한 토픽 인덱스 */
  unscored: number[];
  usage: TokenUsage;
  failedChunks: string[];
}

/** 모델이 범위를 벗어난 값을 낼 수 있다. DB check 제약(1~5)에 걸리기 전에 잡는다 */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function toScoredTopic(raw: TopicScore, offset: number): ScoredTopic | null {
  // topicNumber 는 청크 안에서 1부터
  const local = raw.topicNumber - 1;
  if (local < 0) return null;

  const novelty = { score: clampScore(raw.novelty.score), reason: raw.novelty.reason.trim() };
  const impact = { score: clampScore(raw.impact.score), reason: raw.impact.reason.trim() };
  const interest = { score: clampScore(raw.interest.score), reason: raw.interest.reason.trim() };

  return {
    index: offset + local,
    novelty,
    impact,
    interest,
    total: novelty.score + impact.score + interest.score,
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 동시 실행 수를 제한하며 처리한다 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}

export async function scoreTopics(
  client: AnthropicClient,
  topics: readonly ScoringTopicInput[],
  /**
   * 채점 기준을 갈아끼우는 자리. **실험용이다** — 파이프라인은 항상 기본값으로 부른다.
   *
   * 루브릭을 바꿨을 때 같은 토픽이 어떻게 다르게 채점되는지 보려면 두 기준으로
   * 같은 입력을 돌려야 한다 (`pnpm ranking:sim`). env 로 빼지 않은 것은
   * 배포 설정에서 채점 기준이 조용히 바뀌면 안 되기 때문이다
   */
  system: string = SCORING_SYSTEM,
): Promise<ScoreTopicsResult> {
  if (topics.length === 0) {
    return { scored: [], unscored: [], usage: ZERO_USAGE, failedChunks: [] };
  }

  const chunks = chunk(
    topics.map((topic, index) => ({ topic, index })),
    thresholds.scoringChunkSize,
  );

  const chunkResults = await mapWithConcurrency(
    chunks,
    thresholds.scoringConcurrency,
    async (group) => {
      const offset = group[0]!.index;
      try {
        const response = await client.messages.parse({
          model: models.score,
          max_tokens: 8000,
          // 청크마다 동일하다. 캐시 프리픽스가 된다
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [
            { role: 'user', content: buildScoringPrompt(group.map((g) => g.topic)) },
          ],
          output_config: { format: zodOutputFormat(ScoringResultSchema) },
        });

        const parsed = response.parsed_output;
        if (!parsed) throw new Error('구조화 출력 파싱 실패');

        return {
          scored: parsed.scores
            .map((raw) => toScoredTopic(raw, offset))
            .filter((s): s is ScoredTopic => s !== null),
          usage: readUsage(response.usage),
          error: null as string | null,
        };
      } catch (error) {
        return {
          scored: [] as ScoredTopic[],
          usage: ZERO_USAGE,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  const scored: ScoredTopic[] = [];
  const failedChunks: string[] = [];
  let usage = ZERO_USAGE;

  for (const result of chunkResults) {
    usage = addUsage(usage, result.usage);
    if (result.error) failedChunks.push(result.error);
    for (const s of result.scored) {
      // 청크 경계를 넘는 인덱스는 버린다
      if (s.index >= 0 && s.index < topics.length) scored.push(s);
    }
  }

  // 인덱스 중복 제거 (먼저 온 쪽 유지)
  const seen = new Set<number>();
  const unique = scored.filter((s) => (seen.has(s.index) ? false : (seen.add(s.index), true)));

  const unscored = topics.map((_, i) => i).filter((i) => !seen.has(i));

  return { scored: unique, unscored, usage, failedChunks };
}
