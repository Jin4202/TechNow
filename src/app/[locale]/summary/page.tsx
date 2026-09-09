import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { SummaryMarkdown } from '@/components/summary-markdown';
import { features } from '@/config/features';
import { toLocale } from '@/config/locales';
import { listMySummaries } from '@/db/monthly-summaries';
import { getProfile } from '@/db/profiles';
import { createClient } from '@/db/supabase/server';

/**
 * 월간 요약 페이지 (로드맵 6.7, 6.8).
 *
 * `premium` 플래그로 가린다 (6.8). 기본값이 true 라 지금은 모두에게 보이고,
 * 나중에 유료화할 때 마이그레이션 없이 끌 수 있다 (기획서 §2.6).
 *
 * 플래그가 꺼진 사용자에게는 **404 다.** "유료 회원 전용" 안내를 띄우지 않는다 —
 * 지금은 그런 등급이 존재하지 않고, 없는 상품을 광고하는 화면이 된다.
 */
export default async function SummaryPage({ params }: PageProps<'/[locale]/summary'>) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  // 계정 기능이 잠겨 있으면 없는 페이지다 (7.0c)
  if (!features.accounts) notFound();

  const t = await getTranslations();
  const supabase = await createClient();
  const profile = await getProfile(supabase);

  if (!profile) redirect(`/${locale}/login`);
  if (!profile.premium) notFound();

  const summaries = await listMySummaries(supabase);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('summary.title')}</h1>
        <Link
          href={`/${locale}`}
          className="text-sm text-black/60 hover:underline dark:text-white/60"
        >
          {t('nav.allArticles')}
        </Link>
      </header>

      <main className="flex flex-col gap-12">
        {summaries.length === 0 ? (
          <p className="py-16 text-center text-sm text-black/50 dark:text-white/50">
            {t('summary.empty')}
          </p>
        ) : (
          summaries.map((summary) => (
            <section key={`${summary.monthStart}-${summary.locale}`}>
              <div className="mb-4 flex items-baseline gap-3 border-b border-black/10 pb-2 dark:border-white/15">
                <h2 className="text-lg font-medium">
                  {/* 요약을 받은 시점의 언어로 쓰여 있다. 날짜 형식은 화면 언어를 따른다 */}
                  {new Date(`${summary.monthStart}T00:00:00Z`).toLocaleDateString(
                    locale === 'ko' ? 'ko-KR' : 'en-US',
                    { year: 'numeric', month: 'long', timeZone: 'UTC' },
                  )}
                </h2>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {t('summary.articleCount', { count: summary.articleIds.length })}
                </span>
              </div>

              <SummaryMarkdown text={summary.summaryText} locale={locale} />
            </section>
          ))
        )}
      </main>
    </div>
  );
}
