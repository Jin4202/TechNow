import { describe, expect, it } from 'vitest';

import { normalizeUrl, urlHash } from '@/pipeline/discover/normalize-url';

describe('normalizeUrl', () => {
  it('추적 파라미터를 제거한다', () => {
    expect(normalizeUrl('https://example.org/a?utm_source=rss&utm_medium=feed')).toBe(
      'https://example.org/a',
    );
  });

  it('추적이 아닌 파라미터는 남긴다', () => {
    expect(normalizeUrl('https://example.org/a?id=7&utm_source=rss')).toBe(
      'https://example.org/a?id=7',
    );
  });

  it('www 와 호스트 대소문자를 무시한다', () => {
    expect(normalizeUrl('https://WWW.Example.ORG/a')).toBe('https://example.org/a');
  });

  it('프래그먼트를 제거한다', () => {
    expect(normalizeUrl('https://example.org/a#section-2')).toBe('https://example.org/a');
  });

  it('끝 슬래시를 제거하되 루트는 건드리지 않는다', () => {
    expect(normalizeUrl('https://example.org/a/')).toBe('https://example.org/a');
    expect(normalizeUrl('https://example.org/')).toBe('https://example.org/');
  });

  it('파라미터 순서가 달라도 같은 URL 이다', () => {
    expect(normalizeUrl('https://example.org/a?b=2&a=1')).toBe(
      normalizeUrl('https://example.org/a?a=1&b=2'),
    );
  });

  it('경로 대소문자는 구분한다 (다른 문서일 수 있다)', () => {
    expect(normalizeUrl('https://example.org/A')).not.toBe(normalizeUrl('https://example.org/a'));
  });

  it('URL 이 아니면 원문을 돌려준다', () => {
    expect(normalizeUrl('  not a url  ')).toBe('not a url');
  });
});

describe('urlHash', () => {
  it('정규화 후 같으면 같은 해시', () => {
    expect(urlHash('https://www.example.org/a/?utm_source=x#y')).toBe(
      urlHash('https://example.org/a'),
    );
  });

  it('다른 기사면 다른 해시', () => {
    expect(urlHash('https://example.org/a')).not.toBe(urlHash('https://example.org/b'));
  });

  it('sha256 16진 문자열이다', () => {
    expect(urlHash('https://example.org/a')).toMatch(/^[0-9a-f]{64}$/);
  });
});
