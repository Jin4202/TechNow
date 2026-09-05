import { describe, expect, it } from 'vitest';

import { feeds } from '@/config/feeds';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { createFetchContext, fetchPage } from '@/pipeline/research/fetch-page';

// 실제 사이트에서 본문을 뽑는다. 여기가 3.4 의 위험 지점이다.
// 실행: pnpm fetch:live

describe('실제 페이지 추출 (2.5, 3.4)', () => {
  it('피드마다 실제 기사에서 본문을 뽑는다', async () => {
    const { items } = await fetchFeeds(feeds);
    const unique = dedupeItems(items);

    // 피드마다 첫 기사 하나씩
    const samples = feeds
      .map((f) => unique.find((i) => i.feedName === f.name))
      .filter((i): i is NonNullable<typeof i> => i !== undefined);

    const context = createFetchContext();
    const results = [];

    for (const item of samples) {
      const started = Date.now();
      const page = await fetchPage(context, item.url);
      results.push({ feed: item.feedName, page, ms: Date.now() - started });
    }

    console.log('');
    for (const { feed, page, ms } of results) {
      if (page.ok) {
        const preview = page.text.slice(0, 90).replace(/\n/g, ' ');
        console.log(`✓ ${feed.padEnd(14)} ${String(page.text.length).padStart(6)}자 ${ms}ms`);
        console.log(`  제목: ${page.title?.slice(0, 70) ?? '(없음)'}`);
        console.log(`  본문: ${preview}…`);
      } else {
        console.log(`✗ ${feed.padEnd(14)} ${page.reason} ${page.detail ?? ''} (${ms}ms)`);
      }
    }

    const ok = results.filter((r) => r.page.ok);
    console.log(`\n성공 ${ok.length}/${results.length}`);

    // 최소 과반은 성공해야 조사 단계가 성립한다
    expect(ok.length).toBeGreaterThanOrEqual(Math.ceil(results.length / 2));
  }, 300_000);

  it('같은 도메인 연속 요청 사이에 간격이 있다 (CLAUDE.md §2.8)', async () => {
    const { items } = await fetchFeeds(feeds);
    const unique = dedupeItems(items);
    const sameHost = unique.filter((i) => i.feedName === 'phys-org').slice(0, 3);

    const context = createFetchContext();
    const started = Date.now();
    for (const item of sameHost) await fetchPage(context, item.url);
    const elapsed = Date.now() - started;

    // robots.txt 1회 + 페이지 3회. 페이지 사이 간격이 최소 2번 들어간다
    console.log(`\n같은 도메인 ${sameHost.length}건: ${elapsed}ms`);
    expect(elapsed).toBeGreaterThan(2 * 1500);
  }, 300_000);
});
