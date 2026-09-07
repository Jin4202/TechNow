import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CoverImage } from '@/components/cover-image';
import en from '@/messages/en.json';
import ko from '@/messages/ko.json';

/**
 * 커버의 AI 생성 표기 (7.9, D-52).
 *
 * **표기가 이 컴포넌트의 존재 이유다.** 커버 화풍을 사진 품질로 바꾸면서
 * "실제 취재 사진" 오해 위험을 안고 가기로 했고(D-38 을 뒤집었다), 표기가 그
 * 상쇄 수단이다. 표기 없이 렌더되는 경로가 생기면 여기서 깨져야 한다.
 */

function render(node: React.ReactElement, messages: Record<string, unknown> = en) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

const SRC = 'https://example.org/cover.jpg';

describe('CoverImage', () => {
  describe('표기는 두 variant 모두에서 반드시 나온다', () => {
    it('기사 페이지 — 캡션으로', () => {
      const html = render(<CoverImage src={SRC} variant="article" />);

      expect(html).toContain(en.article.coverNotice);
      // figcaption 이라야 화면낭독기가 이미지의 설명으로 읽는다
      expect(html).toContain('<figcaption');
      expect(html).toContain('<figure');
    });

    it('목록 카드 — 배지 + sr-only 전체 문구', () => {
      const html = render(<CoverImage src={SRC} variant="card" />);

      expect(html).toContain(en.article.coverBadge);
      // 배지만 있으면 낭독기에 "AI" 두 글자만 읽힌다. 전체 문구가 같이 있어야 한다
      expect(html).toContain('sr-only');
      expect(html).toContain(en.article.coverNotice);
    });

    it('한국어에서도 나온다', () => {
      const html = render(<CoverImage src={SRC} variant="article" />, ko);
      expect(html).toContain(ko.article.coverNotice);
    });
  });

  it('alt 는 비어 있다 — 커버는 장식이다', () => {
    // 생성된 그림의 설명을 저장하지 않으므로 지어낸 alt 는 틀린 설명이 된다.
    // 고지는 alt 가 아니라 캡션·sr-only 가 맡는다
    for (const variant of ['card', 'article'] as const) {
      const html = render(<CoverImage src={SRC} variant={variant} />);
      expect(html, variant).toContain('alt=""');
    }
  });

  it('이미지를 실제로 그린다', () => {
    const html = render(<CoverImage src={SRC} variant="card" />);
    expect(html).toContain('img');
  });
});
