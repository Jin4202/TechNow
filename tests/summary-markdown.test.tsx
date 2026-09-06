import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SummaryMarkdown } from '@/components/summary-markdown';

/**
 * 월간 요약 렌더 (로드맵 6.7).
 *
 * 우리가 만든 마크다운의 부분집합만 다룬다. 지키려는 것은
 * **저장된 텍스트가 화면에서 무엇이든 될 수 없다** 는 것이다 —
 * 링크 목적지를 본문에서 받지 않고 슬러그로만 조립한다.
 */

function render(text: string) {
  return renderToStaticMarkup(<SummaryMarkdown text={text} locale="en" />);
}

describe('SummaryMarkdown', () => {
  it('소제목과 기사 링크를 렌더한다', () => {
    const html = render('## Space & Astronomy\n\n- [Roman launches](roman-slug) — What happened.');

    expect(html).toContain('Space &amp; Astronomy');
    expect(html).toContain('href="/en/articles/roman-slug"');
    expect(html).toContain('What happened.');
  });

  it('링크 목적지를 본문에서 그대로 쓰지 않는다', () => {
    // 슬러그 자리에 외부 URL 이 들어와도 기사 경로로만 조립된다
    const html = render('- [Click](https://evil.test/steal) — text');

    expect(html).not.toContain('href="https://evil.test/steal"');
    expect(html).toContain('/en/articles/');
  });

  it('원시 HTML 을 해석하지 않는다', () => {
    const html = render('<img src=x onerror="alert(1)">');

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('평범한 문단은 그대로 문단이다', () => {
    const html = render('A month of space and biology.');

    expect(html).toContain('<p');
    expect(html).toContain('A month of space and biology.');
  });

  it('빈 줄은 건너뛴다', () => {
    const html = render('One.\n\n\n\nTwo.');
    expect(html.match(/<p/g)).toHaveLength(2);
  });
});
