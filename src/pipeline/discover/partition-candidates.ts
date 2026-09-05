import type { FeedItem } from './parse-feed';

/**
 * 수집한 항목을 "이번 런에서 처리할 후보"와 "새로 기록할 항목"으로 나눈다 (D-01).
 *
 * 순수 함수다. DB는 인자로 받은 스냅샷으로만 다룬다 (CLAUDE.md §3).
 *
 * 규칙:
 *   - 처음 보는 항목 → 후보이면서 pending 으로 새로 기록
 *   - 이미 pending 인 항목 → 후보. 지난 런이 중간에 죽어 아직 처리되지 않았다
 *   - 이미 processed 인 항목 → 제외. 선정에서 탈락한 것도 처리 완료다
 */

export interface SeenRow {
  urlHash: string;
  status: 'pending' | 'processed';
}

export interface PartitionResult {
  /** 이번 런이 그룹핑·채점에 넘길 항목 */
  candidates: FeedItem[];
  /** seen_feed_items 에 pending 으로 새로 넣을 항목 */
  toInsert: FeedItem[];
  /** 이미 pending 이라 다시 후보가 된 항목 수 (로그용) */
  resumedCount: number;
  /** processed 라서 걸러진 항목 수 (로그용) */
  skippedCount: number;
}

export function partitionCandidates(
  items: readonly FeedItem[],
  seen: readonly SeenRow[],
): PartitionResult {
  const status = new Map(seen.map((row) => [row.urlHash, row.status]));

  const candidates: FeedItem[] = [];
  const toInsert: FeedItem[] = [];
  let resumedCount = 0;
  let skippedCount = 0;

  for (const item of items) {
    const known = status.get(item.urlHash);

    if (known === 'processed') {
      skippedCount += 1;
      continue;
    }

    candidates.push(item);

    if (known === 'pending') {
      resumedCount += 1;
    } else {
      toInsert.push(item);
    }
  }

  return { candidates, toInsert, resumedCount, skippedCount };
}
