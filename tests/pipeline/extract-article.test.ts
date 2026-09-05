import { describe, expect, it } from 'vitest';

import { extractArticle, looksPaywalled } from '@/pipeline/research/extract-article';

const page = (body: string) =>
  `<!doctype html><html><head><title>테스트 기사</title></head><body>
    <nav>메뉴 홈 로그인 구독</nav>
    <article>${body}</article>
    <footer>회사 소개 이용약관</footer>
  </body></html>`;

const paragraph = (n: number) =>
  `<p>${'Researchers reported a measurable improvement in the new prototype device. '.repeat(n)}</p>`;

describe('extractArticle', () => {
  it('본문을 뽑고 네비게이션을 걷어낸다', () => {
    const result = extractArticle(page(paragraph(20)), 'https://example.org/a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('Researchers reported');
    expect(result.text).not.toContain('이용약관');
  });

  it('제목을 읽는다', () => {
    const result = extractArticle(page(paragraph(20)), 'https://example.org/a');
    expect(result.ok && result.title).toBe('테스트 기사');
  });

  it('본문이 없으면 no-content', () => {
    const result = extractArticle('<html><body></body></html>', 'https://example.org/a');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-content');
  });

  it('짧으면 too-short', () => {
    const result = extractArticle(page('<p>한 줄뿐.</p>'), 'https://example.org/a');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['too-short', 'no-content']).toContain(result.reason);
  });

  it('구독 유도 문구가 있으면 paywalled', () => {
    const result = extractArticle(
      page(`${paragraph(20)}<p>Subscribe to continue reading this article.</p>`),
      'https://example.org/a',
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('paywalled');
  });

  it('페이월 판정이 길이 판정보다 먼저다 (사유가 더 정확하다)', () => {
    const result = extractArticle(page('<p>Subscribers only.</p>'), 'https://example.org/a');
    if (result.ok) throw new Error('통과하면 안 된다');
    // 짧기도 하지만 페이월이 더 정확한 사유다
    expect(['paywalled', 'no-content']).toContain(result.reason);
  });

  it('깨진 HTML 에도 던지지 않는다', () => {
    expect(() => extractArticle('<html><body><p>미완성', 'https://example.org/a')).not.toThrow();
  });

  it('연속 공백을 정리한다', () => {
    const result = extractArticle(
      page(`<p>${'word   word\n\n\n\nword '.repeat(60)}</p>`),
      'https://example.org/a',
    );
    if (!result.ok) return;
    expect(result.text).not.toMatch(/ {2,}/);
    expect(result.text).not.toMatch(/\n{3,}/);
  });
});

describe('looksPaywalled', () => {
  it('대소문자를 가리지 않는다', () => {
    expect(looksPaywalled('SUBSCRIBE TO CONTINUE now')).toBe(true);
  });

  it('일반 본문은 아니다', () => {
    expect(looksPaywalled('The team published results in Nature.')).toBe(false);
  });
});

describe('협찬 기사 감지', () => {
  const sponsored = (lead: string) =>
    extractArticle(
      page(`<p>${lead}${'Industrial cable carriers require regular inspection and maintenance. '.repeat(20)}</p>`),
      'https://example.org/a',
    );

  it('본문 앞의 협찬 표시를 잡는다', () => {
    // 실제 사례: IEEE Spectrum 의 제목은 멀쩡했고 본문 첫 줄이 협찬 표시였다.
    // 제목만 보는 저비용 필터(2.1)로는 못 잡는다
    const r = sponsored('This article is brought to you by Tsubaki KabelSchlepp. ');
    expect(r.ok && r.sponsored).toBe(true);
  });

  it('일반 기사는 협찬이 아니다', () => {
    const r = sponsored('Researchers at the university reported that ');
    expect(r.ok && r.sponsored).toBe(false);
  });

  it('협찬이어도 추출은 성공한다 (판단은 호출자 몫)', () => {
    const r = sponsored('Sponsored content: ');
    expect(r.ok).toBe(true);
  });
});
