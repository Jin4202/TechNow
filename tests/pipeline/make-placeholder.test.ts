import { describe, expect, it } from 'vitest';

import { CATEGORY_VALUES } from '@/config/categories';
import { makePlaceholder, makeSlug } from '@/pipeline/discover/make-placeholder';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

const item = (over: Partial<FeedItem> = {}): FeedItem => ({
  urlHash: 'a'.repeat(64),
  feedName: 'nasa',
  title: 'Webb telescope finds water',
  description: 'A description.',
  url: 'https://example.org/x',
  publishedAt: null,
  ...over,
});

describe('makeSlug', () => {
  it('제목을 소문자 하이픈으로 바꾸고 해시를 붙인다', () => {
    expect(makeSlug('Webb Telescope Finds Water', 'abcdef1234')).toBe(
      'webb-telescope-finds-water-abcdef12',
    );
  });

  it('기호를 걷어낸다', () => {
    expect(makeSlug('AI: what now?! (2026)', 'deadbeef00')).toBe('ai-what-now-2026-deadbeef');
  });

  it('한글만 있으면 해시만 남는다', () => {
    // slug 는 unique 라 빈 문자열이 되면 두 번째 기사부터 삽입이 실패한다
    expect(makeSlug('우주 망원경이 물을 찾았다', 'cafe0000ff')).toBe('cafe0000');
  });

  it('아주 긴 제목을 자른다', () => {
    const slug = makeSlug('word '.repeat(50), '12345678');
    expect(slug.length).toBeLessThanOrEqual(70);
    expect(slug.endsWith('-12345678')).toBe(true);
  });

  it('잘린 끝에 하이픈이 남지 않는다', () => {
    expect(makeSlug('a'.repeat(59) + ' b', '12345678')).not.toContain('--');
  });
});

describe('makePlaceholder', () => {
  it('피드의 첫 카테고리를 쓴다', () => {
    expect(makePlaceholder(item({ feedName: 'nasa' })).category).toBe('space-astronomy');
    expect(makePlaceholder(item({ feedName: 'ars-technica' })).category).toBe('ai-computing');
  });

  it('모르는 피드는 기본 카테고리로 떨어진다', () => {
    const c = makePlaceholder(item({ feedName: 'unknown-feed' })).category;
    expect(CATEGORY_VALUES).toContain(c);
  });

  it('body 가 sections 배열이다 (DB check 제약)', () => {
    const body = makePlaceholder(item()).body;
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections[0]!.paragraphs.length).toBeGreaterThan(0);
  });

  it('topic_hash 는 항목의 urlHash 다 (멱등성 키)', () => {
    expect(makePlaceholder(item()).topic_hash).toBe('a'.repeat(64));
  });

  it('published 상태여야 목록에 보인다 (RLS는 published 만 공개)', () => {
    const a = makePlaceholder(item());
    expect(a.status).toBe('published');
    expect(a.published_at).toBeTruthy();
  });

  it('설명이 비면 제목을 요약으로 쓴다', () => {
    expect(makePlaceholder(item({ description: '' })).one_line_summary).toBe(
      'Webb telescope finds water',
    );
  });

  it('긴 설명을 200자로 자른다', () => {
    const a = makePlaceholder(item({ description: 'x'.repeat(500) }));
    expect(a.one_line_summary).toHaveLength(200);
  });
});
