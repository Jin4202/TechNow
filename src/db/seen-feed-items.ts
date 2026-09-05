import { thresholds } from '@/config/thresholds';

import type { ServiceClient } from '@/db/supabase/service';
import type { FeedItem } from '@/pipeline/discover/parse-feed';
import type { SeenRow } from '@/pipeline/discover/partition-candidates';

/**
 * seen_feed_items 저장소 (D-01).
 *
 * 상태 전이는 파이프라인 전체의 재실행 안전성을 좌우한다:
 *   신규 → pending → (선정 단계 정상 종료) → processed
 * 런이 중간에 죽으면 pending 으로 남아 다음 날 다시 후보가 된다.
 */

/** 주어진 해시들의 현재 상태를 읽는다 */
export async function getSeenRows(
  db: ServiceClient,
  urlHashes: readonly string[],
): Promise<SeenRow[]> {
  if (urlHashes.length === 0) return [];

  const rows: SeenRow[] = [];
  // in() 은 필터가 URL 쿼리스트링에 들어간다. sha256 해시는 64자라
  // 청크가 크면 게이트웨이가 "URI too long" 으로 거절한다.
  // 50 × (64자 + 구분자) ≈ 3.5KB 로 8KB 한도 안에 든다
  const CHUNK = 50;

  for (let i = 0; i < urlHashes.length; i += CHUNK) {
    const { data, error } = await db
      .from('seen_feed_items')
      .select('url_hash, status')
      .in('url_hash', urlHashes.slice(i, i + CHUNK));

    if (error) throw new Error(`seen_feed_items 조회 실패: ${error.message}`);
    rows.push(...(data ?? []).map((r) => ({ urlHash: r.url_hash, status: r.status })));
  }

  return rows;
}

/** 새 항목을 pending 으로 기록한다. 이미 있으면 건드리지 않는다 */
export async function insertPending(
  db: ServiceClient,
  items: readonly FeedItem[],
  runId: string | null,
): Promise<number> {
  if (items.length === 0) return 0;

  const { error, count } = await db.from('seen_feed_items').upsert(
    items.map((item) => ({
      url_hash: item.urlHash,
      feed_name: item.feedName,
      run_id: runId,
      status: 'pending' as const,
    })),
    { onConflict: 'url_hash', ignoreDuplicates: true, count: 'exact' },
  );

  if (error) throw new Error(`seen_feed_items 기록 실패: ${error.message}`);
  return count ?? items.length;
}

/**
 * 선정 단계가 정상 종료된 뒤 호출한다.
 *
 * 임계값에 못 미쳐 **탈락한 항목도 processed** 다. 탈락은 정상적인 처리 완료이며,
 * 매일 다시 채점하면 고정비만 든다 (D-01).
 */
export async function markProcessed(
  db: ServiceClient,
  urlHashes: readonly string[],
): Promise<number> {
  if (urlHashes.length === 0) return 0;

  let updated = 0;
  // getSeenRows 와 같은 이유로 작게 자른다
  const CHUNK = 50;

  for (let i = 0; i < urlHashes.length; i += CHUNK) {
    const { error, count } = await db
      .from('seen_feed_items')
      .update({ status: 'processed', processed_at: new Date().toISOString() }, { count: 'exact' })
      .in('url_hash', urlHashes.slice(i, i + CHUNK))
      .eq('status', 'pending');

    if (error) throw new Error(`seen_feed_items 갱신 실패: ${error.message}`);
    updated += count ?? 0;
  }

  return updated;
}

/**
 * 오래된 행을 정리한다.
 * pending 은 짧게 (식은 뉴스), processed 는 길게 (재게시 항목을 계속 걸러야 한다).
 */
export async function cleanupSeenItems(
  db: ServiceClient,
  now: Date = new Date(),
): Promise<{ pendingDeleted: number; processedDeleted: number }> {
  const dayMs = 24 * 60 * 60 * 1000;
  const asDate = (d: Date) => d.toISOString().slice(0, 10);

  const pendingCutoff = asDate(new Date(now.getTime() - thresholds.pendingTtlDays * dayMs));
  const processedCutoff = asDate(
    new Date(now.getTime() - thresholds.processedRetentionDays * dayMs),
  );

  const { error: e1, count: pendingDeleted } = await db
    .from('seen_feed_items')
    .delete({ count: 'exact' })
    .eq('status', 'pending')
    .lt('first_seen_on', pendingCutoff);
  if (e1) throw new Error(`pending 정리 실패: ${e1.message}`);

  const { error: e2, count: processedDeleted } = await db
    .from('seen_feed_items')
    .delete({ count: 'exact' })
    .eq('status', 'processed')
    .lt('first_seen_on', processedCutoff);
  if (e2) throw new Error(`processed 정리 실패: ${e2.message}`);

  return { pendingDeleted: pendingDeleted ?? 0, processedDeleted: processedDeleted ?? 0 };
}
