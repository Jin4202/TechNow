import Link from 'next/link';

import type { Locale } from '@/config/locales';

/**
 * 월간 요약 렌더 (로드맵 6.7).
 *
 * **우리가 만든 마크다운만 다룬다** (`src/pipeline/summarize/monthly-summary.ts`).
 * 모델이 마크다운을 쓰지 않으므로 문법의 부분집합이 고정돼 있다 —
 * `## 소제목`, `- [제목](슬러그) — 설명`, 그리고 평범한 문단.
 *
 * 범용 마크다운 라이브러리를 넣지 않는 이유: 우리가 쓰지 않는 문법
 * (이미지, 원시 HTML, 링크 URL)까지 해석하게 되고, 그것은 곧 저장된 텍스트가
 * 화면에서 무엇이든 될 수 있다는 뜻이다. 여기서는 링크 목적지도 우리가 만든다 —
 * 본문의 슬러그를 기사 경로로 바꿔 붙일 뿐 임의의 URL 을 열지 않는다.
 */

const LINK_LINE = /^- \[(.+?)\]\((.+?)\)\s+—\s+(.*)$/;

export function SummaryMarkdown({ text, locale }: { text: string; locale: Locale }) {
  const blocks = text.split('\n').map((line) => line.trim()).filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((line, index) => {
        if (line.startsWith('## ')) {
          return (
            <h2 key={index} className="mt-4 text-sm font-medium tracking-tight">
              {line.slice(3)}
            </h2>
          );
        }

        const link = LINK_LINE.exec(line);
        if (link) {
          const [, title, slug, description] = link;
          return (
            <p key={index} className="text-[0.95rem] leading-relaxed">
              <Link
                href={`/${locale}/articles/${slug}`}
                className="font-medium underline-offset-2 hover:underline"
              >
                {title}
              </Link>{' '}
              <span className="text-black/70 dark:text-white/70">{description}</span>
            </p>
          );
        }

        return (
          <p key={index} className="text-[0.95rem] leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
}
