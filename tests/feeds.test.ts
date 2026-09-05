import { describe, expect, it } from 'vitest';

import { CATEGORY_VALUES } from '@/config/categories';
import { FEED_USER_AGENT, feeds } from '@/config/feeds';

describe('feeds', () => {
  it('3~5개다 (D-16)', () => {
    expect(feeds.length).toBeGreaterThanOrEqual(3);
    expect(feeds.length).toBeLessThanOrEqual(5);
  });

  it('name 이 중복되지 않는다 (seen_feed_items.feed_name 에 쓰인다)', () => {
    expect(new Set(feeds.map((f) => f.name)).size).toBe(feeds.length);
  });

  it('URL 이 중복되지 않고 https 다', () => {
    expect(new Set(feeds.map((f) => f.url)).size).toBe(feeds.length);
    for (const f of feeds) expect(f.url, f.name).toMatch(/^https:\/\//);
  });

  it('7개 카테고리를 모두 커버한다', () => {
    const covered = new Set(feeds.flatMap((f) => f.covers));
    for (const c of CATEGORY_VALUES) {
      expect(covered.has(c), `${c} 를 커버하는 피드가 없다`).toBe(true);
    }
  });

  it('어느 카테고리도 단일 피드에만 의존하지 않는다 (D-16)', () => {
    // 피드 하나가 죽어도 그 카테고리가 통째로 비지 않아야 한다
    for (const c of CATEGORY_VALUES) {
      const n = feeds.filter((f) => f.covers.includes(c)).length;
      expect(n, `${c} 를 커버하는 피드가 ${n}개뿐이다`).toBeGreaterThanOrEqual(2);
    }
  });

  it('식별 가능한 User-Agent 를 쓴다 (CLAUDE.md §2.8)', () => {
    expect(FEED_USER_AGENT).toMatch(/TechNow/);
    expect(FEED_USER_AGENT).toMatch(/https?:\/\//);
  });
});
