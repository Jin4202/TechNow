import { describe, it } from 'vitest';

import { feeds } from '@/config/feeds';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';

describe('샘플', () => {
  it('제목 전량 출력', async () => {
    const { items } = await fetchFeeds(feeds);
    const unique = dedupeItems(items);
    for (const i of unique) {
      console.log(`${i.feedName}\t${i.description.length}\t${i.title}`);
    }
  }, 90_000);
});
