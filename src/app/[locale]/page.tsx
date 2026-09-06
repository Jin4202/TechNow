import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { logout } from '@/app/[locale]/login/actions';
import { ArticleCard } from '@/components/article-card';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { LOCALES, toLocale } from '@/config/locales';
import { getProfile } from '@/db/profiles';
import { listPublishedArticles } from '@/db/published-articles';
import { createClient } from '@/db/supabase/server';

/** 목록도 두 언어판이 서로를 가리킨다 (D-08) */
export async function generateMetadata({ params }: PageProps<'/[locale]'>) {
  const locale = toLocale((await params).locale);
  return {
    alternates: {
      canonical: `/${locale}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
    },
  };
}

export default async function Home({ params }: PageProps<'/[locale]'>) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations();
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    articles,
  ] = await Promise.all([supabase.auth.getUser(), listPublishedArticles(supabase, locale)]);

  // 월간 요약은 premium 플래그로 가린다 (6.8). 기본값이 true 라 지금은 모두 보인다.
  // 링크를 남겨두면 눌러서 404 를 만나게 되므로, 페이지의 404 와 함께 링크도 숨긴다
  const profile = user ? await getProfile(supabase) : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('site.name')}</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {t('site.tagline')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <LocaleSwitcher current={locale} />

          {profile?.premium ? (
            <Link
              href={`/${locale}/summary`}
              className="text-sm text-black/60 hover:underline dark:text-white/60"
            >
              {t('summary.title')}
            </Link>
          ) : null}

          {user ? (
            <Link
              href={`/${locale}/scraps`}
              className="text-sm text-black/60 hover:underline dark:text-white/60"
            >
              {t('scraps.folder')}
            </Link>
          ) : null}

          {user ? (
            <Link
              href={`/${locale}/profile`}
              className="text-sm text-black/60 hover:underline dark:text-white/60"
            >
              {t('nav.profile')}
            </Link>
          ) : null}

          {user ? (
            <form action={logout}>
              <button
                type="submit"
                className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
              >
                {t('nav.logOut')}
              </button>
            </form>
          ) : (
            <Link
              href={`/${locale}/login`}
              className="rounded-md bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
            >
              {t('nav.logIn')}
            </Link>
          )}
        </div>
      </header>

      <main>
        {articles.length === 0 ? (
          // 기획서 §2.1 — 임계값을 넘은 토픽이 없는 날
          <p className="py-16 text-center text-sm text-black/50 dark:text-white/50">
            {t('home.empty')}
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
