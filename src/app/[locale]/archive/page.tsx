import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { LOCALES, toLocale } from '@/config/locales';
import { listArchiveMonths } from '@/db/published-articles';
import { createClient } from '@/db/supabase/server';

import type { Locale } from '@/config/locales';

/**
 * 아카이브 — 월 목록 (로드맵 7.8).
 *
 * 메인은 최신 30건에서 잘린다. 하루 3건이면 열흘이면 차므로, 그보다 이전 기사를
 * 찾는 길이 여기다.
 *
 * 월별로 나누는 이유: 한 달에 90편까지 되므로 전부 한 페이지에 넣으면 금방
 * 무거워진다. 여기는 목록만, 기사는 `/archive/[month]` 가 보여준다.
 */

export async function generateMetadata({ params }: PageProps<'/[locale]/archive'>) {
  const locale = toLocale((await params).locale);

  return {
    alternates: {
      canonical: `/${locale}/archive`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/archive`])),
    },
  };
}

/** `2026-09` → `September 2026` / `2026년 9월` */
export function monthLabel(month: string, locale: Locale): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(
    locale === 'ko' ? 'ko-KR' : 'en-US',
    { year: 'numeric', month: 'long', timeZone: 'UTC' },
  );
}

export default async function ArchivePage({ params }: PageProps<'/[locale]/archive'>) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations();
  const supabase = await createClient();
  const months = await listArchiveMonths(supabase);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('archive.title')}</h1>
        <Link
          href={`/${locale}`}
          className="text-sm text-black/60 hover:underline dark:text-white/60"
        >
          {t('nav.allArticles')}
        </Link>
      </header>

      <main>
        {months.length === 0 ? (
          <p className="py-16 text-center text-sm text-black/50 dark:text-white/50">
            {t('archive.empty')}
          </p>
        ) : (
          <ul className="flex flex-col">
            {months.map((entry) => (
              <li key={entry.month} className="border-b border-black/10 dark:border-white/10">
                <Link
                  href={`/${locale}/archive/${entry.month}`}
                  className="flex items-baseline justify-between gap-4 py-3.5 hover:underline"
                >
                  <span className="text-base font-medium">
                    {monthLabel(entry.month, locale)}
                  </span>
                  <span className="text-xs text-black/50 dark:text-white/50">
                    {t('archive.articleCount', { count: entry.articleCount })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
