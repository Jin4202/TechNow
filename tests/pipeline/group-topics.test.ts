import { describe, expect, it } from 'vitest';

import { assembleTopics, fallbackTopics } from '@/pipeline/group/group-topics';
import { buildGroupingPrompt } from '@/prompts/group-topics';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

const item = (title: string): FeedItem => ({
  urlHash: title,
  feedName: 'f',
  title,
  description: `${title} 설명`,
  url: `https://example.org/${title}`,
  publishedAt: null,
});

const items = [item('A'), item('B'), item('C'), item('D')];
const recent = [
  { id: 'art-1', title: '지난주 화성 착륙' },
  { id: 'art-2', title: '지난주 배터리' },
];

describe('assembleTopics', () => {
  it('번호를 항목으로 옮긴다', () => {
    const topics = assembleTopics(
      [{ title: '같은 사건', itemNumbers: [1, 2], followUpOf: null }],
      items,
      recent,
    );
    expect(topics[0]!.items.map((i) => i.title)).toEqual(['A', 'B']);
  });

  it('followUpOf 를 기사 id 로 바꾼다', () => {
    const topics = assembleTopics(
      [{ title: 't', itemNumbers: [1], followUpOf: 1 }],
      items,
      recent,
    );
    expect(topics[0]!.followUpOfArticleId).toBe('art-1');
  });

  it('followUpOf 가 null 이면 새 토픽이다', () => {
    const topics = assembleTopics([{ title: 't', itemNumbers: [1], followUpOf: null }], items, recent);
    expect(topics[0]!.followUpOfArticleId).toBeNull();
  });

  it('범위 밖 followUpOf 는 null 로 떨어진다', () => {
    const topics = assembleTopics([{ title: 't', itemNumbers: [1], followUpOf: 99 }], items, recent);
    expect(topics[0]!.followUpOfArticleId).toBeNull();
  });

  it('누락된 항목을 단독 토픽으로 살린다', () => {
    // 모델이 3, 4번을 빠뜨렸다. 조용히 버리면 그 기사는 영영 후보가 못 된다
    const topics = assembleTopics(
      [{ title: '묶음', itemNumbers: [1, 2], followUpOf: null }],
      items,
      recent,
    );
    expect(topics).toHaveLength(3);
    expect(topics.flatMap((t) => t.items.map((i) => i.title)).sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('같은 항목이 두 토픽에 오면 먼저 온 쪽만 갖는다', () => {
    const topics = assembleTopics(
      [
        { title: '첫째', itemNumbers: [1, 2], followUpOf: null },
        { title: '둘째', itemNumbers: [2, 3], followUpOf: null },
      ],
      items,
      recent,
    );
    expect(topics[0]!.items.map((i) => i.title)).toEqual(['A', 'B']);
    expect(topics[1]!.items.map((i) => i.title)).toEqual(['C']);
  });

  it('없는 번호만 든 토픽은 버린다', () => {
    const topics = assembleTopics(
      [
        { title: '허수', itemNumbers: [99], followUpOf: null },
        { title: '정상', itemNumbers: [1], followUpOf: null },
      ],
      items,
      recent,
    );
    // 허수 토픽은 사라지고, 나머지 항목은 단독 토픽으로 살아난다
    expect(topics.find((t) => t.title === '허수')).toBeUndefined();
    expect(topics.flatMap((t) => t.items)).toHaveLength(4);
  });

  it('제목이 비면 첫 항목 제목을 쓴다', () => {
    const topics = assembleTopics([{ title: '   ', itemNumbers: [1], followUpOf: null }], items, recent);
    expect(topics[0]!.title).toBe('A');
  });
});

describe('fallbackTopics', () => {
  it('항목 하나당 토픽 하나 (기획서 §2.1)', () => {
    const topics = fallbackTopics(items);
    expect(topics).toHaveLength(4);
    expect(topics.every((t) => t.items.length === 1)).toBe(true);
    expect(topics.every((t) => t.followUpOfArticleId === null)).toBe(true);
  });
});

describe('buildGroupingPrompt', () => {
  it('후보와 최근 기사를 1부터 번호 매긴다', () => {
    const prompt = buildGroupingPrompt({
      candidates: [{ title: 'T1', description: 'D1' }],
      recentTitles: ['R1'],
    });
    expect(prompt).toContain('1. T1');
    expect(prompt).toContain('1. R1');
  });

  it('최근 기사가 없으면 (none)', () => {
    const prompt = buildGroupingPrompt({ candidates: [{ title: 'T', description: 'D' }], recentTitles: [] });
    expect(prompt).toContain('(none)');
  });

  it('긴 설명을 300자로 자른다', () => {
    const prompt = buildGroupingPrompt({
      candidates: [{ title: 'T', description: 'x'.repeat(1000) }],
      recentTitles: [],
    });
    expect(prompt).not.toContain('x'.repeat(301));
    expect(prompt).toContain('x'.repeat(300));
  });
});
