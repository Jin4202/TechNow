import { logger, schedules } from '@trigger.dev/sdk';

import { getAnthropic } from '@/clients/anthropic';
import { previousMonthStart } from '@/db/monthly-scraps';
import { monthlyAlerts } from '@/pipeline/alerts';
import { createServiceClient } from '@/db/supabase/service';
import { runMonthlySummaries } from '@/pipeline/run-monthly';

import { alertTask } from './alert';

/**
 * 월간 요약 태스크 (로드맵 6.6).
 *
 * CLAUDE.md §3 — 얇은 래퍼다. 흐름은 src/pipeline/run-monthly.ts 에 있다.
 *
 * 매월 1일 08:00 America/Los_Angeles. 발행(07:00)이 끝난 뒤에 돈다 —
 * 그날 아침 발행된 기사는 지난달 스크랩이 아니므로 순서가 결과를 바꾸지는 않지만,
 * 두 배치가 겹치면 로그를 읽기 어렵다.
 *
 * 세 번째이자 마지막 스케줄이다 (D-04 — 무료 티어 한도 10개).
 */
export const monthlySummary = schedules.task({
  id: 'monthly-summary',
  cron: {
    pattern: '0 8 1 * *',
    timezone: 'America/Los_Angeles',
    environments: ['PRODUCTION'],
  },
  // 사용자 수만큼 순차로 돈다. 지금 규모에서는 넉넉하다
  maxDuration: 1800,
  // 재시도하지 않는다. upsert 라 다시 돌려도 안전하지만, 실패한 사용자만
  // 골라내는 것이 아니라 전체를 다시 부르게 되어 비용이 두 배가 된다.
  // 대시보드에서 손으로 다시 돌릴 수 있다 (기획서 §11)
  retry: { maxAttempts: 1 },
  run: async (payload) => {
    const monthStart = previousMonthStart(payload.timestamp);

    logger.info('월간 요약 시작', { monthStart, scheduledAt: payload.timestamp });

    const result = await runMonthlySummaries(createServiceClient(), getAnthropic(), monthStart, {
      onWarn: (message, data) => logger.warn(message, data),
      onInfo: (message, data) => logger.info(message, data),
    });

    if (result.users === 0) {
      // 스크랩한 사람이 아무도 없는 달. 실패가 아니다 (기획서 §2.6)
      logger.info('지난달 스크랩이 없다', { monthStart });
    }

    logger.info('월간 요약 완료', {
      users: result.users,
      summaries: result.summariesWritten,
      skipped: result.skipped.length,
      costUsd: result.costUsd,
    });

    for (const alert of monthlyAlerts({ skipped: result.skipped.length, users: result.users })) {
      await alertTask.trigger(alert);
    }

    return result;
  },
});
