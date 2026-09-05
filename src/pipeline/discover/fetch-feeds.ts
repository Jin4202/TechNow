import { FEED_USER_AGENT, type Feed } from '@/config/feeds';

import { parseFeed, type FeedItem } from './parse-feed';

/**
 * 모든 피드를 가져와 항목으로 만든다.
 *
 * 한 피드가 실패해도 나머지는 진행한다 (기획서 §2.1, 로드맵 1.7).
 * 실패한 피드는 그날 건너뛰고 로그에만 남긴다.
 */

export interface FeedFailure {
  feedName: string;
  reason: string;
}

export interface FetchFeedsResult {
  items: FeedItem[];
  failures: FeedFailure[];
}

export interface FetchFeedsOptions {
  /** 테스트에서 주입한다 */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

async function fetchOne(
  feed: Feed,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FeedItem[]> {
  // Phys.org 는 기본 User-Agent 를 400으로 거부한다 (D-16)
  const response = await fetchImpl(feed.url, {
    headers: { 'User-Agent': FEED_USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseFeed(await response.text(), feed.name);
}

export async function fetchFeeds(
  feeds: readonly Feed[],
  options: FetchFeedsOptions = {},
): Promise<FetchFeedsResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const settled = await Promise.allSettled(
    feeds.map((feed) => fetchOne(feed, fetchImpl, timeoutMs)),
  );

  const items: FeedItem[] = [];
  const failures: FeedFailure[] = [];

  settled.forEach((result, index) => {
    const feed = feeds[index]!;
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      failures.push({
        feedName: feed.name,
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    }
  });

  return { items, failures: failures };
}

/**
 * 여러 피드가 같은 기사를 실을 수 있다. url_hash 로 한 번만 남긴다.
 * 먼저 온 쪽의 feed_name 을 유지한다
 */
export function dedupeItems(items: readonly FeedItem[]): FeedItem[] {
  const seen = new Map<string, FeedItem>();
  for (const item of items) {
    if (!seen.has(item.urlHash)) seen.set(item.urlHash, item);
  }
  return [...seen.values()];
}
