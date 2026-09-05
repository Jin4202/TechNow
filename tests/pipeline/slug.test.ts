import { describe, expect, it } from 'vitest';

import { makeSlug } from '@/pipeline/write/slug';

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
    // slug 는 unique 다. 빈 문자열이 되면 두 번째 기사부터 삽입이 실패한다
    expect(makeSlug('우주 망원경이 물을 찾았다', 'cafe0000ff')).toBe('cafe0000');
  });

  it('아주 긴 제목을 자른다', () => {
    const slug = makeSlug('word '.repeat(50), '12345678');
    expect(slug.length).toBeLessThanOrEqual(70);
    expect(slug.endsWith('-12345678')).toBe(true);
  });

  it('잘린 끝에 하이픈이 남지 않는다', () => {
    expect(makeSlug(`${'a'.repeat(59)} b`, '12345678')).not.toContain('--');
  });
});
