import Link from 'next/link';

import { categoryLabel } from '@/config/categories';

import type { ArticleListItem } from '@/db/published-articles';

/** 목록의 기사 한 건. 커버 이미지는 Phase 5에서 붙는다 */
export function ArticleCard({ article }: { article: ArticleListItem }) {
  const published = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-CA', {
        timeZone: 'America/Los_Angeles',
      })
    : null;

  return (
    <article className="border-b border-black/10 py-5 last:border-0 dark:border-white/10">
      <Link href={`/articles/${article.slug}`} className="group block">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/50 dark:text-white/50">
          <span className="rounded-full border border-black/15 px-2 py-0.5 dark:border-white/20">
            {categoryLabel(article.category, 'en')}
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
