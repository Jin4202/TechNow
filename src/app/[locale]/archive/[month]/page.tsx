import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { monthLabel } from '@/app/[locale]/archive/page';
import { ArticleCard } from '@/components/article-card';
import { LOCALES, toLocale } from '@/config/locales';
import { listPublishedArticles, publishMonthRange } from '@/db/published-articles';
import { createClient } from '@/db/supabase/server';

/**
 * 아카이브 — 한 달의 기사 (로드맵 7.8).
 *
 * 카드는 홈과 같은 컴포넌트다. 같은 기사가 두 곳에서 다르게 보일 이유가 없다.
 *
 * 상한을 100 으로 둔다. 하루 3건이면 한 달 최대 93편이라 한 달치는 다 들어간다 —
 * 여기서 또 잘리면 아카이브를 만든 이유가 없어진다.
 */

const MONTH_LIMIT = 100;

export async function generateMetadata({ params }: PageProps<'/[locale]/archive/[month]'>) {
  const { locale: localeParam, month } = await params;
  const locale = toLocale(localeParam);

  if (!publishMonthRange(month)) return { title: 'Not found' };

  return {
    title: monthLabel(month, locale),
    alternates: {
      canonical: `/${locale}/archive/${month}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/archive/${month}`])),
    },
  };
}

export default async function ArchiveMonthPage({
  params,
}: PageProps<'/[locale]/archive/[month]'>) {
  const { locale: localeParam, month } = await params;
  const locale = toLocale(localeParam);
  setRequestLocale(locale);

  // `2026-13` 이나 `abc` 로 들어오면 없는 페이지다. 조용히 빈 목록을 보여주면
  // 그달에 기사가 없는 것처럼 읽힌다
  if (!publishMonthRange(month)) notFound();

  const t = await getTranslations();
  const supabase = await createClient();
  const articles = await listPublishedArticles(supabase, locale, { month, limit: MONTH_LIMIT });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{monthLabel(month, locale)}</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {t('archive.articleCount', { count: articles.length })}
          </p>
        </div>
        <Link
          href={`/${locale}/archive`}
          className="text-sm text-black/60 hover:underline dark:text-white/60"
        >
          {t('archive.title')}
        </Link>
      </header>

      <main>
        {articles.length === 0 ? (
          <p className="py-16 text-center text-sm text-black/50 dark:text-white/50">
            {t('archive.emptyMonth')}
          </p>
        ) : (
          <div>
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} locale={locale} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
