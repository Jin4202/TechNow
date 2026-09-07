import Link from 'next/link';

import { CoverImage } from '@/components/cover-image';
import { categoryLabel } from '@/config/categories';

import type { Locale } from '@/config/locales';
import type { ArticleListItem } from '@/db/published-articles';

/**
 * 목록의 기사 한 건 (1.12, 5.6).
 *
 * 커버는 `CoverImage` 가 그린다 — AI 생성 표기가 이미지와 한 덩어리여야
 * 한쪽만 빠지는 일이 없다 (D-52).
 */
export function ArticleCard({ article, locale }: { article: ArticleListItem; locale: Locale }) {
  const published = article.published_at
    ? // 두 언어 모두 같은 형식(2026-09-05)을 쓴다. 발행 시각은 사실이지
      // 문체가 아니고, 목록에서 날짜 형식이 언어마다 달라지면 정렬이 읽히지 않는다
      new Date(article.published_at).toLocaleDateString('en-CA', {
        timeZone: 'America/Los_Angeles',
      })
    : null;

  return (
    <article className="border-b border-black/10 py-5 last:border-0 dark:border-white/10">
      <Link href={`/${locale}/articles/${article.slug}`} className="group block">
        {article.cover_image_url ? (
          <CoverImage src={article.cover_image_url} variant="card" />
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/50 dark:text-white/50">
          <span className="rounded-full border border-black/15 px-2 py-0.5 dark:border-white/20">
            {categoryLabel(article.category, locale)}
          </span>
          {published ? <time dateTime={article.published_at!}>{published}</time> : null}
        </div>

        <h2 className="mt-2 text-lg leading-snug font-medium group-hover:underline">
          {article.title}
        </h2>

        <p className="mt-1 line-clamp-2 text-sm text-black/60 dark:text-white/60">
          {article.one_line_summary}
        </p>
      </Link>
    </article>
  );
}
