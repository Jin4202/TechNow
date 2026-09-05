import { logger, task } from '@trigger.dev/sdk';

import { feeds } from '@/config/feeds';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';

/**
 * 피드 수집 태스크 (로드맵 1.6, 1.7).
 *
 * CLAUDE.md §3 — 얇은 래퍼다. 판단 로직은 전부 src/pipeline/discover 에 있다.
 * 여기서는 호출하고, 로그를 남기고, 결과를 돌려주기만 한다.
 *
 * seen_feed_items 기록은 1.8 에서 붙는다.
 */
export const discoverFeeds = task({
  id: 'discover-feeds',
  retry: { maxAttempts: 1 },
  run: async () => {
    const { items, failures } = await fetchFeeds(feeds);
    const unique = dedupeItems(items);

    // 실패한 피드는 그날 건너뛰고 로그에만 남긴다 (기획서 §2.1)
    for (const failure of failures) {
      logger.warn('피드 수집 실패', { ...failure });
    }

    const perFeed: Record<string, number> = {};
    for (const item of unique) {
      perFeed[item.feedName] = (perFeed[item.feedName] ?? 0) + 1;
    }

    logger.info('피드 수집 완료', {
      feeds: feeds.length,
      failed: failures.length,
      rawItems: items.length,
      uniqueItems: unique.length,
      perFeed,
    });

    return {
      uniqueItems: unique.length,
      rawItems: items.length,
      failures,
      perFeed,
    };
  },
});
