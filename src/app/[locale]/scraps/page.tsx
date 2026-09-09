import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ArticleCard } from '@/components/article-card';
import { features } from '@/config/features';
import { toLocale } from '@/config/locales';
import { listScraps } from '@/db/scraps';
import { createClient } from '@/db/supabase/server';

/**
 * 스크랩 폴더 (로드맵 6.2).
 *
 * 로그인이 필요하다 (기획서 §2.7). 목록 카드는 홈과 같은 컴포넌트를 쓴다 —
 * 같은 기사가 두 곳에서 다르게 보일 이유가 없다.
 *
 * 스크랩한 순서로 보여준다. 폴더는 "내가 모은 것" 이지 "최신 뉴스" 가 아니다.
 */
export default async function ScrapsPage({ params }: PageProps<'/[locale]/scraps'>) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  // 계정 기능이 잠겨 있으면 없는 페이지다 (7.0c)
  if (!features.accounts) notFound();

  const t = await getTranslations();
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // `scraps` 는 anon 에게 권한이 없다. 조회하기 전에 돌려보낸다
  if (!user) redirect(`/${locale}/login`);

  const articles = await listScraps(supabase, locale);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('scraps.folder')}</h1>
        <Link
          href={`/${locale}`}
          className="text-sm text-black/60 hover:underline dark:text-white/60"
        >
          {t('nav.allArticles')}
        </Link>
      </header>

      <main>
        {articles.length === 0 ? (
          <p className="py-16 text-center text-sm text-black/50 dark:text-white/50">
            {t('scraps.empty')}
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
