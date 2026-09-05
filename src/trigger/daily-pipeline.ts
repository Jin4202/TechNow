import { logger, schedules } from '@trigger.dev/sdk';

import { getAnthropic } from '@/clients/anthropic';
import { createServiceClient } from '@/db/supabase/service';
import { runDailyDiscovery } from '@/pipeline/run-daily';

/**
 * 일간 파이프라인 (로드맵 1.11).
 *
 * CLAUDE.md §3 — 얇은 래퍼다. 흐름은 src/pipeline/run-daily.ts 에 있다.
 *
 * 01:00 America/Los_Angeles 시작. 발행은 07:00 별도 스케줄이 맡는다 (D-04).
 * 두 런을 하나로 묶어 6시간 대기시키면 파이프라인 장애가 그대로 발행 장애가 된다.
 */
export const dailyPipeline = schedules.task({
  id: 'daily-pipeline',
  cron: {
    pattern: '0 1 * * *',
    timezone: 'America/Los_Angeles',
    // dev 환경에서 스케줄이 도는 것을 막는다. 로컬은 수동 실행으로 확인한다
    environments: ['PRODUCTION'],
  },
  // 런 전체는 재시도하지 않는다. 실패해도 pending 항목이 남아 다음 날 재처리된다
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    logger.info('일간 런 시작', {
      scheduledAt: payload.timestamp,
      lastRunAt: payload.lastTimestamp,
      timezone: payload.timezone,
    });

    const result = await runDailyDiscovery(createServiceClient(), getAnthropic(), {
      onWarn: (message, data) => logger.warn(message, data),
      onInfo: (message, data) => logger.info(message, data),
    });

    logger.info('일간 런 완료', { ...result, failures: result.failures.length });
    return result;
  },
});
