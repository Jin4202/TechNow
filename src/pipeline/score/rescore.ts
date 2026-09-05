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
import { fetchPage, type FetchContext } from '@/pipeline/research/fetch-page';
import {
  buildRescorePrompt,
  SCORING_SYSTEM,
  ScoringResultSchema,
} from '@/prompts/score-topics';

import type { ScoredTopic } from './score-topics';

/**
 * 근접 재채점 (로드맵 2.5).
 *
 * 1차 채점은 RSS 설명만 보고 매긴 값이다. 임계선 근처 토픽만 원문을 가져와
 * 다시 채점한다. 명확히 위/아래인 토픽은 fetch 하지 않는다 — 페이지 수집이
 * 고정비에서 가장 비싼 부분이고, 결론이 뒤집힐 여지도 없다.
 */

export interface RescoreCandidate {
  /** scored 배열의 원소 */
  score: ScoredTopic;
  title: string;
  /** 이 토픽을 촉발한 항목의 URL */
  triggerUrl: string;
  followUpOfTitle?: string | null;
}

export interface RescoreOutcome {
  index: number;
  /** 재채점이 실제로 이뤄졌는지 */
  rescored: boolean;
  /** 실패 사유 (fetch 실패 등) */
  reason?: string;
  before: ScoredTopic;
  after: ScoredTopic;
}

export interface RescoreResult {
  outcomes: RescoreOutcome[];
  usage: TokenUsage;
  pagesFetched: number;
}

/**
 * 재채점할 토픽을 고른다 (D-19).
 *
 * 1차 점수 상위 N개. 동점이면 먼저 온 순서를 유지해 결정적으로 만든다.
 *
 * 기획서의 "임계선 ±2" 밴드 방식을 대체했다. 밴드는 대상 수가 점수 분포에
 * 따라 요동치는데(실측 134개 중 72개), 상한이 3인 이상 실제로 판단이
 * 필요한 건 상위 몇 개뿐이다.
 */
export function selectForRescore<T extends { total: number }>(
  scored: readonly T[],
  limit: number = thresholds.rescoreTopN,
): T[] {
  return scored
    .map((score, order) => ({ score, order }))
    .sort((a, b) => b.score.total - a.score.total || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.score);
}

export async function rescoreTopics(
  client: AnthropicClient,
  fetchContext: FetchContext,
  candidates: readonly RescoreCandidate[],
): Promise<RescoreResult> {
  const outcomes: RescoreOutcome[] = [];
  let usage = ZERO_USAGE;
  let pagesFetched = 0;

  // 순차 처리한다. fetchPage 가 도메인별 간격을 지켜야 하고,
  // 대상이 소수(밴드 안 토픽)라 병렬화 이득이 크지 않다
  for (const candidate of candidates) {
    const { score, triggerUrl } = candidate;

    const page = await fetchPage(fetchContext, triggerUrl);
    if (!page.ok) {
      outcomes.push({
        index: score.index,
        rescored: false,
        reason: `fetch 실패: ${page.reason}`,
        before: score,
        after: score,
      });
      continue;
    }
    pagesFetched += 1;

    try {
      const response = await client.messages.parse({
        model: models.rescore,
        max_tokens: 2000,
        system: SCORING_SYSTEM,
        messages: [
          {
            role: 'user',
            content: buildRescorePrompt({
              title: candidate.title,
              firstPass: {
                novelty: score.novelty.score,
                impact: score.impact.score,
                interest: score.interest.score,
              },
              articleTitle: page.title,
              articleText: page.text,
              followUpOfTitle: candidate.followUpOfTitle ?? null,
            }),
          },
        ],
        output_config: { format: zodOutputFormat(ScoringResultSchema) },
      });

      usage = addUsage(usage, readUsage(response.usage));

      const raw = response.parsed_output?.scores[0];
      if (!raw) throw new Error('재채점 결과가 비어 있음');

      const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(n)));
      const after: ScoredTopic = {
        index: score.index,
        novelty: { score: clamp(raw.novelty.score), reason: raw.novelty.reason.trim() },
        impact: { score: clamp(raw.impact.score), reason: raw.impact.reason.trim() },
        interest: { score: clamp(raw.interest.score), reason: raw.interest.reason.trim() },
        total: 0,
      };
      after.total = after.novelty.score + after.impact.score + after.interest.score;

      outcomes.push({ index: score.index, rescored: true, before: score, after });
    } catch (error) {
      // 재채점에 실패하면 1차 점수를 그대로 쓴다. 토픽을 버리지 않는다
      outcomes.push({
        index: score.index,
        rescored: false,
        reason: error instanceof Error ? error.message : String(error),
        before: score,
        after: score,
      });
    }
  }

  return { outcomes, usage, pagesFetched };
}
