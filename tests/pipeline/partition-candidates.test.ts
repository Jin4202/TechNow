import { describe, expect, it } from 'vitest';

import { partitionCandidates } from '@/pipeline/discover/partition-candidates';

import type { FeedItem } from '@/pipeline/discover/parse-feed';
import type { SeenRow } from '@/pipeline/discover/partition-candidates';

const item = (urlHash: string): FeedItem => ({
  urlHash,
  feedName: 'f',
  title: 't',
  description: 'd',
  url: `https://example.org/${urlHash}`,
  publishedAt: null,
});

describe('partitionCandidates (D-01)', () => {
  it('처음 보는 항목은 후보이면서 새로 기록된다', () => {
    const r = partitionCandidates([item('a'), item('b')], []);
    expect(r.candidates.map((i) => i.urlHash)).toEqual(['a', 'b']);
    expect(r.toInsert.map((i) => i.urlHash)).toEqual(['a', 'b']);
  });

  it('processed 항목은 제외된다', () => {
    const seen: SeenRow[] = [{ urlHash: 'a', status: 'processed' }];
    const r = partitionCandidates([item('a'), item('b')], seen);
    expect(r.candidates.map((i) => i.urlHash)).toEqual(['b']);
    expect(r.skippedCount).toBe(1);
  });

  it('탈락해서 processed 가 된 항목도 다시 채점하지 않는다', () => {
    // 임계값 미달로 탈락한 항목도 processed 다. 매일 재채점하면 고정비만 든다
    const seen: SeenRow[] = [{ urlHash: 'rejected', status: 'processed' }];
    const r = partitionCandidates([item('rejected')], seen);
    expect(r.candidates).toEqual([]);
    expect(r.toInsert).toEqual([]);
  });

  it('pending 으로 남은 항목은 다시 후보가 되고, 중복 기록하지 않는다', () => {
    // 지난 런이 그룹핑 중에 죽은 경우
    const seen: SeenRow[] = [{ urlHash: 'a', status: 'pending' }];
    const r = partitionCandidates([item('a'), item('b')], seen);
    expect(r.candidates.map((i) => i.urlHash)).toEqual(['a', 'b']);
    expect(r.toInsert.map((i) => i.urlHash)).toEqual(['b']);
    expect(r.resumedCount).toBe(1);
  });

  it('두 번 연속 실행해도 후보 집합이 같다 (런이 죽었을 때)', () => {
    const items = [item('a'), item('b'), item('c')];
    const first = partitionCandidates(items, []);
    // 첫 런이 pending 기록까지만 하고 죽었다고 가정
    const seen: SeenRow[] = first.toInsert.map((i) => ({
      urlHash: i.urlHash,
      status: 'pending' as const,
    }));
    const second = partitionCandidates(items, seen);

    expect(second.candidates.map((i) => i.urlHash)).toEqual(['a', 'b', 'c']);
    expect(second.toInsert).toEqual([]);
    expect(second.resumedCount).toBe(3);
  });

  it('선정이 끝나 processed 가 되면 다음 런의 후보가 비어 있다', () => {
    const items = [item('a'), item('b')];
    const seen: SeenRow[] = items.map((i) => ({
      urlHash: i.urlHash,
      status: 'processed' as const,
    }));
    const r = partitionCandidates(items, seen);
    expect(r.candidates).toEqual([]);
    expect(r.skippedCount).toBe(2);
  });

  it('빈 입력을 처리한다', () => {
    const r = partitionCandidates([], [{ urlHash: 'a', status: 'pending' }]);
    expect(r).toEqual({ candidates: [], toInsert: [], resumedCount: 0, skippedCount: 0 });
  });
});
