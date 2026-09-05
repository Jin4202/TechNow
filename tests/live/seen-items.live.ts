import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  cleanupSeenItems,
  getSeenRows,
  insertPending,
  markProcessed,
} from '@/db/seen-feed-items';
import { createServiceClient } from '@/db/supabase/service';
import { partitionCandidates } from '@/pipeline/discover/partition-candidates';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

// 로컬 Supabase 스택이 떠 있어야 한다 (supabase start).
// 실행: pnpm db:live
const db = createServiceClient();

const PREFIX = 'livetest-';
const item = (id: string): FeedItem => ({
  urlHash: `${PREFIX}${id}`,
  feedName: 'live-feed',
  title: `제목 ${id}`,
  description: 'd',
  url: `https://example.org/${id}`,
  publishedAt: null,
});

async function wipe() {
  await db.from('seen_feed_items').delete().like('url_hash', `${PREFIX}%`);
}

beforeAll(wipe);
afterAll(wipe);

describe('seen_feed_items 상태 전이 (D-01)', () => {
  it('두 번 실행해도 항목당 한 행만 기록된다 (1.8)', async () => {
    const items = [item('a'), item('b')];

    await insertPending(db, items, null);
    await insertPending(db, items, null);

    const rows = await getSeenRows(db, items.map((i) => i.urlHash));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('런이 중간에 죽으면 pending 으로 남아 다음 런의 후보가 된다', async () => {
    const items = [item('a'), item('b')];

    // 다음 날 런: 같은 항목을 다시 수집
    const seen = await getSeenRows(db, items.map((i) => i.urlHash));
    const result = partitionCandidates(items, seen);

    expect(result.candidates).toHaveLength(2);
    expect(result.toInsert).toHaveLength(0);
    expect(result.resumedCount).toBe(2);
  });

  it('선정이 끝나면 processed 가 되고 다음 런에서 제외된다', async () => {
    const items = [item('a'), item('b')];
    const hashes = items.map((i) => i.urlHash);

    const updated = await markProcessed(db, hashes);
    expect(updated).toBe(2);

    const seen = await getSeenRows(db, hashes);
    expect(seen.every((r) => r.status === 'processed')).toBe(true);

    const result = partitionCandidates(items, seen);
    expect(result.candidates).toHaveLength(0);
    expect(result.skippedCount).toBe(2);
  });

  it('markProcessed 는 pending 인 행만 건드린다', async () => {
    // 이미 processed 인 것을 다시 부르면 0건
    expect(await markProcessed(db, [item('a').urlHash])).toBe(0);
  });

  it('processed 행에는 processed_at 이 채워진다 (check 제약)', async () => {
    const { data } = await db
      .from('seen_feed_items')
      .select('status, processed_at')
      .eq('url_hash', item('a').urlHash)
      .single();

    expect(data?.status).toBe('processed');
    expect(data?.processed_at).not.toBeNull();
  });

  it('오래된 pending 을 정리한다 (TTL 3일)', async () => {
    const stale = item('stale');
    await insertPending(db, [stale], null);
    // 10일 전으로 되돌린다
    await db
      .from('seen_feed_items')
      .update({ first_seen_on: '2026-08-01' })
      .eq('url_hash', stale.urlHash);

    const { pendingDeleted } = await cleanupSeenItems(db);
    expect(pendingDeleted).toBeGreaterThanOrEqual(1);

    const rows = await getSeenRows(db, [stale.urlHash]);
    expect(rows).toHaveLength(0);
  });
});
