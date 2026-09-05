import { describe, expect, it } from 'vitest';

import { FEED_USER_AGENT } from '@/config/feeds';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';

import type { Feed } from '@/config/feeds';
import type { FeedItem } from '@/pipeline/discover/parse-feed';

function rss(title: string, url: string): string {
  return `<rss version="2.0"><channel><item>
    <title>${title}</title><link>${url}</link><description>d</description>
  </item></channel></rss>`;
}

const FEEDS: Feed[] = [
  { name: 'good-one', url: 'https://a.example/feed', covers: ['ai-computing'], approxItems: 1 },
  { name: 'broken', url: 'https://b.example/feed', covers: ['ai-computing'], approxItems: 1 },
  { name: 'good-two', url: 'https://c.example/feed', covers: ['ai-computing'], approxItems: 1 },
];

function mockFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

describe('fetchFeeds', () => {
  it('한 피드가 죽어도 나머지는 진행한다 (1.7)', async () => {
    const { items, failures } = await fetchFeeds(FEEDS, {
      fetchImpl: mockFetch((url) => {
        if (url.includes('b.example')) throw new Error('ECONNREFUSED');
        return new Response(rss('T', `https://x.example/${url.length}`));
      }),
    });

    expect(items).toHaveLength(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ feedName: 'broken', reason: 'ECONNREFUSED' });
  });

  it('HTTP 오류도 그 피드만 실패로 남긴다', async () => {
    const { items, failures } = await fetchFeeds(FEEDS, {
      fetchImpl: mockFetch((url) =>
        url.includes('b.example')
          ? new Response('nope', { status: 400 })
          : new Response(rss('T', `https://x.example/${url.length}`)),
      ),
    });

    expect(items).toHaveLength(2);
    expect(failures[0]!.reason).toBe('HTTP 400');
  });

  it('전부 실패해도 던지지 않는다 (그날 런이 통째로 죽으면 안 된다)', async () => {
    const { items, failures } = await fetchFeeds(FEEDS, {
      fetchImpl: mockFetch(() => {
        throw new Error('네트워크 없음');
      }),
    });

    expect(items).toEqual([]);
    expect(failures).toHaveLength(3);
  });

  it('식별 가능한 User-Agent 를 보낸다 (Phys.org 는 없으면 400)', async () => {
    const seen: string[] = [];
    const capturing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get('User-Agent') ?? '');
      return new Response(rss('T', `https://x.example/${String(input).length}`));
    }) as typeof fetch;

    await fetchFeeds(FEEDS, { fetchImpl: capturing });
    expect(seen).toHaveLength(3);
    expect(new Set(seen)).toEqual(new Set([FEED_USER_AGENT]));
  });
});

describe('dedupeItems', () => {
  const make = (urlHash: string, feedName: string): FeedItem => ({
    urlHash,
    feedName,
    title: 't',
    description: 'd',
    url: 'https://example.org/x',
    publishedAt: null,
  });

  it('여러 피드가 같은 기사를 실으면 하나만 남긴다', () => {
    const out = dedupeItems([make('h1', 'a'), make('h1', 'b'), make('h2', 'c')]);
    expect(out).toHaveLength(2);
  });

  it('먼저 온 피드의 이름을 유지한다', () => {
    const out = dedupeItems([make('h1', 'first'), make('h1', 'second')]);
    expect(out[0]!.feedName).toBe('first');
  });
});
