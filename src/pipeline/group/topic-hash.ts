import { createHash } from 'node:crypto';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

/**
 * 토픽의 멱등성 키 (ARCHITECTURE §2).
 *
 * `(run_id, topic_hash)` 유니크 인덱스가 재시도 시 기사 중복 생성을 막는다.
 *
 * 구성 항목의 URL 해시 집합으로 만든다 — 그룹핑이 같은 항목들을 묶으면
 * 순서가 달라도 같은 해시가 나와야 한다.
 */
export function topicHash(items: readonly FeedItem[]): string {
  const key = [...items.map((i) => i.urlHash)].sort().join('|');
  return createHash('sha256').update(key).digest('hex');
}
