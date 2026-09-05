import { logger, task } from '@trigger.dev/sdk';

import { createServiceClient } from '@/db/supabase/service';
import { runDailyDiscovery } from '@/pipeline/run-daily';

/**
 * 일간 파이프라인 태스크 (로드맵 1.6~1.10).
 *
 * CLAUDE.md §3 — 얇은 래퍼다. 흐름은 src/pipeline/run-daily.ts 에 있고
 * 여기서는 클라이언트를 만들고, 로거를 넘기고, 결과를 로그로 남긴다.
 */
export const discoverFeeds = task({
  id: 'discover-feeds',
  retry: { maxAttempts: 1 },
  run: async () => {
    const result = await runDailyDiscovery(createServiceClient(), {
      onWarn: (message, data) => logger.warn(message, data),
    });

    logger.info('일간 런 완료', { ...result, failures: result.failures.length });
    return result;
  },
});
