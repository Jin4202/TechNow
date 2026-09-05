import { logger, schedules } from '@trigger.dev/sdk';

import { createServiceClient } from '@/db/supabase/service';
import { publishReadyArticles } from '@/pipeline/publish/publish-ready';

/**
 * 발행 태스크 (로드맵 3.13).
 *
 * 07:00 America/Los_Angeles 에 `ready` 인 기사를 일괄 `published` 로 넘긴다.
 *
 * 일간 파이프라인(01:00)과 **별도 스케줄**이다 (D-04). 파이프라인이 걸려 있거나
 * 실패해도 발행은 독립적으로 돌아 이미 준비된 기사를 내보낸다.
 * 한 런에 6시간 대기를 묶으면 파이프라인 장애가 그대로 발행 장애가 된다.
 */
export const publishBatch = schedules.task({
  id: 'publish-batch',
  cron: {
    pattern: '0 7 * * *',
    timezone: 'America/Los_Angeles',
    environments: ['PRODUCTION'],
  },
  retry: { maxAttempts: 2 },
  run: async (payload) => {
    logger.info('발행 시작', { scheduledAt: payload.timestamp, timezone: payload.timezone });

    const result = await publishReadyArticles(createServiceClient());

    if (result.published === 0) {
      // 기획서 §2.5 — 사이트가 "No new stories today" 를 보여준다
      logger.info('발행할 기사가 없다', { heldBack: result.heldBack, failed: result.failed });
    } else {
      logger.info('발행 완료', { ...result });
    }

    return result;
  },
});
