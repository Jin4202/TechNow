import { describe, expect, it } from 'vitest';

import { feeds } from '@/config/feeds';
import { maxItemAgeDays } from '@/config/filters';
import { applyCheapFilters, summarizeRejections } from '@/pipeline/discover/cheap-filters';
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

  /**
   * 나이 필터가 실제 피드에서 무엇을 잡는지 본다.
   *
   * 단위 테스트는 내가 만든 날짜로 돌지만, 피드가 무엇을 내보내는지는 여기서만 보인다.
   * IEEE Spectrum 이 2021년 기사 3건을 상시 내보내는 것이 이 검사의 이유다.
   * **LLM 호출이 없으므로 비용 0.**
   */
  it('오래된 항목이 어느 피드에서 얼마나 나오는지 본다', async () => {
    const { items } = await fetchFeeds(feeds, { timeoutMs: 25_000 });
    const unique = dedupeItems(items);
    const now = new Date();

    const ageDays = (d: Date) => (now.getTime() - d.getTime()) / 86_400_000;
    const dated = unique.filter((i) => i.publishedAt);

    console.log(`\n나이 상한 ${maxItemAgeDays()}일 — 피드별 분포`);
    for (const feed of new Set(unique.map((i) => i.feedName))) {
      const ages = dated.filter((i) => i.feedName === feed).map((i) => ageDays(i.publishedAt!));
      if (ages.length === 0) {
        console.log(`  ${feed.padEnd(16)} 날짜 있는 항목 없음`);
        continue;
      }
      ages.sort((a, b) => a - b);
      const over = ages.filter((a) => a > maxItemAgeDays()).length;
      console.log(
        `  ${feed.padEnd(16)} ${String(ages.length).padStart(3)}건  ` +
          `중앙 ${ages[Math.floor(ages.length / 2)]!.toFixed(1)}일  ` +
          `최고령 ${ages[ages.length - 1]!.toFixed(1)}일  상한초과 ${over}건`,
      );
    }

    const stale = applyCheapFilters(unique, now).rejected.filter((r) => r.reason === 'stale');
    console.log(`\nstale 로 걸린 항목 ${stale.length}건:`);
    for (const r of stale) {
      console.log(`  ${ageDays(r.item.publishedAt!).toFixed(0).padStart(5)}일  [${r.item.feedName}] ${r.item.title.slice(0, 62)}`);
    }
    console.log('전체 탈락 사유:', summarizeRejections(applyCheapFilters(unique, now).rejected));

    // 필터가 피드를 통째로 죽이면 안 된다. 실측에서 stale 은 150건 중 3건이었다
    expect(stale.length).toBeLessThan(unique.length * 0.1);
  }, 60_000);
});
