import { describe, expect, it } from 'vitest';

import { topicHash } from '@/pipeline/group/topic-hash';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

const item = (urlHash: string): FeedItem => ({
  urlHash,
  feedName: 'f',
  title: 't',
  description: 'd',
  url: 'https://example.org/x',
  publishedAt: null,
});

describe('topicHash', () => {
  it('같은 항목 집합이면 같은 해시', () => {
    expect(topicHash([item('a'), item('b')])).toBe(topicHash([item('a'), item('b')]));
  });

  it('순서가 달라도 같은 해시', () => {
    // 그룹핑이 같은 항목들을 묶으면 순서와 무관하게 같은 토픽이다
    expect(topicHash([item('a'), item('b')])).toBe(topicHash([item('b'), item('a')]));
  });

  it('항목이 다르면 다른 해시', () => {
    expect(topicHash([item('a')])).not.toBe(topicHash([item('b')]));
  });

  it('sha256 16진 문자열', () => {
    expect(topicHash([item('a')])).toMatch(/^[0-9a-f]{64}$/);
  });
});
