import { addUsage, estimateCost, ZERO_USAGE, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { scrapsByUserForMonth } from '@/db/monthly-scraps';
import { saveSummary } from '@/db/monthly-summaries';
import { finishRun, startRun } from '@/db/pipeline-runs';
import { summarizeMonth } from '@/pipeline/summarize/monthly-summary';

import type { ServiceClient } from '@/db/supabase/service';

/**
 * 월간 요약 런 (로드맵 6.6).
 *
 * 매월 1일, 지난달에 스크랩이 있는 **모든** 사용자에게 요약을 만든다.
 * Trigger.dev 에 의존하지 않는다 (CLAUDE.md §3).
 *
 * **한 사용자의 실패가 다른 사용자를 막지 않는다.** 요약은 사용자별로 독립이고,
 * 하나가 깨졌다고 나머지가 못 받을 이유가 없다 — 일간 런이 토픽마다 독립인 것과
 * 같은 이유다 (D-21).
 *
 * 스크랩이 없는 사용자는 애초에 목록에 없다 (기획서 §2.6 — 그런 달에는
 * 요약을 만들지 않는다).
 */

export interface MonthlyRunResult {
  runId: string;
  monthStart: string;
  /** 스크랩이 있어 대상이 된 사용자 수 */
  users: number;
  summariesWritten: number;
  skipped: { userId: string; reason: string }[];
  costUsd: number;
  usage: TokenUsage;
}

export interface MonthlyRunOptions {
  onWarn?: (message: string, data: Record<string, unknown>) => void;
  onInfo?: (message: string, data: Record<string, unknown>) => void;
}

export async function runMonthlySummaries(
  db: ServiceClient,
  claude: AnthropicClient,
  monthStart: string,
  options: MonthlyRunOptions = {},
): Promise<MonthlyRunResult> {
  const runId = await startRun(db, 'monthly');
  const warn = options.onWarn ?? (() => {});
  const info = options.onInfo ?? (() => {});

  try {
    const perUser = await scrapsByUserForMonth(db, monthStart);
    info('월간 요약 대상', { monthStart, users: perUser.length });

    const skipped: MonthlyRunResult['skipped'] = [];
    let summariesWritten = 0;
    let usage = ZERO_USAGE;

    for (const user of perUser) {
      try {
        const result = await summarizeMonth(claude, user.articles, user.locale);
        usage = addUsage(usage, result.usage);

        if (!result.markdown) {
          skipped.push({ userId: user.userId, reason: result.failure ?? 'unknown' });
          warn('요약 생성 실패', {
            userId: user.userId,
            failure: result.failure,
            detail: result.detail ?? '',
          });
          continue;
        }

        await saveSummary(db, {
          userId: user.userId,
          monthStart,
          locale: user.locale,
          summaryText: result.markdown,
          articleIds: result.articleIds,
        });
        summariesWritten += 1;
      } catch (error) {
        // 한 사용자의 실패가 나머지를 막지 않는다
        skipped.push({
          userId: user.userId,
          reason: error instanceof Error ? error.message : String(error),
        });
        warn('요약 저장 실패', { userId: user.userId });
      }
    }

    const costUsd = estimateCost(usage, PRICING[MODEL_SONNET], {
      cacheRead: CACHE_READ_MULTIPLIER,
      cacheWrite: CACHE_WRITE_MULTIPLIER,
    });

    await finishRun(db, runId, 'success', {
      topics_selected: summariesWritten,
      cost_input_tokens: usage.inputTokens,
      cost_output_tokens: usage.outputTokens,
      cost_cached_tokens: usage.cacheReadTokens,
      cost_fixed: 0,
      // 요약은 사용자 수에 비례한다. 기사와 무관하지만 변동비다
      cost_variable: Number(costUsd.toFixed(4)),
      notes: `${monthStart}: 대상 ${perUser.length}명 → 요약 ${summariesWritten}건`,
    });

    return {
      runId,
      monthStart,
      users: perUser.length,
      summariesWritten,
      skipped,
      costUsd: Number(costUsd.toFixed(4)),
      usage,
    };
  } catch (error) {
    await finishRun(db, runId, 'failed', {
      notes: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
