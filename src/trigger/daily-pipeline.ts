import { logger, schedules } from '@trigger.dev/sdk';

import { getAnthropic, ZERO_USAGE } from '@/clients/anthropic';
import { createServiceClient } from '@/db/supabase/service';
import { runDailyDiscovery } from '@/pipeline/run-daily';

import { buildArticleTask } from './build-article';

import type { BuildTopicResult } from '@/pipeline/build-topic';

/**
 * 일간 파이프라인 (로드맵 1.11, 3.12).
 *
 * CLAUDE.md §3 — 얇은 래퍼다. 흐름은 src/pipeline/run-daily.ts 에 있다.
 *
 * 01:00 America/Los_Angeles 시작. 토픽마다 자식 태스크를 띄우고 기다린다 —
 * 한 기사의 실패가 다른 기사를 막지 않고, 재시도도 그 단위로 돈다.
 *
 * 발행은 07:00 별도 스케줄이 맡는다 (D-04).
 */
export const dailyPipeline = schedules.task({
  id: 'daily-pipeline',
  cron: {
    pattern: '0 1 * * *',
    timezone: 'America/Los_Angeles',
    environments: ['PRODUCTION'],
  },
  // 자식 태스크를 기다리는 시간은 체크포인트되어 이 한도에 포함되지 않는다
  maxDuration: 1800,
  // 런 전체는 재시도하지 않는다. 실패해도 pending 항목이 남아 다음 날 재처리된다
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    logger.info('일간 런 시작', {
      scheduledAt: payload.timestamp,
      lastRunAt: payload.lastTimestamp,
      timezone: payload.timezone,
    });

    const result = await runDailyDiscovery(createServiceClient(), getAnthropic(), {
      // 토픽마다 자식 태스크. 실패해도 부모는 다음 순위로 내려간다 (D-21)
      buildTopic: async (input): Promise<BuildTopicResult> => {
        const run = await buildArticleTask.triggerAndWait(input);

        if (run.ok) return run.output;

        // 태스크 자체가 죽은 경우(재시도 소진 등)도 실패한 토픽으로 다룬다
        return {
          articleId: null,
          failure: 'write-failed',
          detail: `자식 태스크 실패: ${run.error instanceof Error ? run.error.message : String(run.error)}`,
          attempts: 0,
          searchCalls: 0,
          pagesFetched: 0,
          sourceCount: 0,
          usageHaiku: ZERO_USAGE,
          usageSonnet: ZERO_USAGE,
        };
      },
      onWarn: (message, data) => logger.warn(message, data),
      onInfo: (message, data) => logger.info(message, data),
    });

    logger.info('일간 런 완료', { ...result, failures: result.failures.length });
    return result;
  },
});
