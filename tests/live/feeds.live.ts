import { describe, expect, it } from 'vitest';

import { feeds } from '@/config/feeds';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';

// 실제 네트워크를 탄다. CI 기본 실행에는 포함되지 않는다 (include 패턴 밖).
// 실행: pnpm feeds:live
describe('실제 피드 수집', () => {
  it('5개 피드에서 항목을 가져온다', async () => {
    const { items, failures } = await fetchFeeds(feeds, { timeoutMs: 25_000 });
    const unique = dedupeItems(items);

    console.log('\n실패한 피드:', failures.length ? failures : '없음');
    const byFeed = new Map<string, number>();
    for (const i of unique) byFeed.set(i.feedName, (byFeed.get(i.feedName) ?? 0) + 1);
    console.log('피드별 항목 수:', Object.fromEntries(byFeed));
    console.log('총 항목:', items.length, '/ 중복 제거 후:', unique.length);
    console.log('날짜 있는 항목:', unique.filter((i) => i.publishedAt).length);
    console.log('\n샘플 3건:');
    for (const i of unique.slice(0, 3)) {
      console.log(` - [${i.feedName}] ${i.title}`);
      console.log(`   ${i.description.slice(0, 90)}…`);
      console.log(`   ${i.url}`);
    }

    expect(failures).toEqual([]);
    expect(unique.length).toBeGreaterThan(80);
    // 모든 항목에 제목과 URL 이 있다
    expect(unique.every((i) => i.title && i.url)).toBe(true);
  }, 60_000);
});
