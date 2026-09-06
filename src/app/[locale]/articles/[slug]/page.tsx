import { getTranslations, setRequestLocale } from 'next-intl/server';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArticleFeedback } from '@/components/article-feedback';
import { ScrapButton } from '@/components/scrap-button';
import { categoryLabel } from '@/config/categories';
import { toLocale } from '@/config/locales';
import { availableLocales, getPublishedArticle } from '@/db/published-articles';
import { isScrapped } from '@/db/scraps';
import { createClient } from '@/db/supabase/server';

/**
 * 기사 상세 페이지 (로드맵 3.14).
 *
 * RLS 가 발행된 기사만 돌려주므로, 발행 전 기사를 slug 로 찔러봐도
 * 존재하지 않는 것과 구분되지 않는다 (D-02).
 */

export async function generateMetadata({ params }: PageProps<'/[locale]/articles/[slug]'>) {
  const { locale, slug } = await params;
  const supabase = await createClient();
  const article = await getPublishedArticle(supabase, slug, toLocale(locale));

  if (!article) return { title: 'Not found' };

  return {
    title: article.title,
    description: article.one_line_summary,
    // 같은 기사의 다른 언어판을 검색엔진에 알린다 (D-08).
    // 이게 없으면 두 언어판이 서로의 중복 콘텐츠로 취급된다
    alternates: {
      canonical: `/${toLocale(locale)}/articles/${slug}`,
      // 번역이 있는 언어만 가리킨다. 없는 언어판은 404 다
      languages: Object.fromEntries(
        (await availableLocales(supabase, article.id)).map((l) => [l, `/${l}/articles/${slug}`]),
      ),
    },
  };
}

export default async function ArticlePage({ params }: PageProps<'/[locale]/articles/[slug]'>) {
  const { slug, locale: localeParam } = await params;
  const locale = toLocale(localeParam);
  setRequestLocale(locale);

  const t = await getTranslations();
  const supabase = await createClient();
  const article = await getPublishedArticle(supabase, slug, locale);

  if (!article) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 로그인하지 않았으면 묻지 않는다. `scraps` 는 anon 에게 권한이 없어
  // 조회 자체가 permission denied 로 떨어진다 — 기사 화면이 통째로 죽는다
  const scrapped = user ? await isScrapped(supabase, article.id, user.id) : false;

  const published = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-CA', {
        timeZone: 'America/Los_Angeles',
      })
    : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-5 py-10 sm:px-6 sm:py-16">
      <nav className="mb-8">
        <Link href={`/${locale}`} className="text-sm text-black/60 hover:underline dark:text-white/60">
          {t('nav.allArticles')}
        </Link>
      </nav>

      <article>
        <header>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-black/50 dark:text-white/50">
            <span className="rounded-full border border-black/15 px-2 py-0.5 dark:border-white/20">
              {categoryLabel(article.category, locale)}
            </span>
            {published ? <time dateTime={article.published_at!}>{published}</time> : null}
          </div>

          <h1 className="mt-3 text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
            {article.title}
          </h1>

          <p className="mt-3 text-base text-black/70 dark:text-white/70">
            {article.one_line_summary}
          </p>

          <div className="mt-4">
            <ScrapButton
              articleId={article.id}
              locale={locale}
              initiallyScrapped={scrapped}
              loggedIn={user !== null}
            />
          </div>
        </header>

        {/* 커버는 장식이라 alt 를 비운다 (5.6). 제목과 요약 다음에 온다 —
            무슨 일인지 먼저 읽고 그림을 본다 */}
        {article.cover_image_url ? (
          <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-lg bg-black/5 dark:bg-white/5">
            <Image
              src={article.cover_image_url}
              alt=""
              fill
              priority
              sizes="(max-width: 672px) 100vw, 672px"
              className="object-cover"
            />
          </div>
        ) : null}

        {/* 이전 기사가 있으면 먼저 알린다. 맥락 없이 후속을 읽으면 이해가 안 된다 */}
        {article.followUpOf ? (
          <p className="mt-6 rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/15">
            <span className="text-black/50 dark:text-white/50">{t('article.follows')} </span>
            <Link href={`/${locale}/articles/${article.followUpOf.slug}`} className="hover:underline">
              {article.followUpOf.title}
            </Link>
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-8">
          {article.body.sections.map((section, index) => (
            <section key={index}>
              <h2 className="text-lg font-medium">{section.heading}</h2>
              <div className="mt-2 flex flex-col gap-3">
                {section.paragraphs.map((paragraph, i) => (
                  <p key={i} className="text-[0.95rem] leading-relaxed">
                    {paragraph}
                  </p>
                ))}
              </div>
              {/* 섹션마다 어느 출처에 근거했는지 (D-03) */}
              {section.sources.length > 0 ? (
                <p className="mt-2 text-xs text-black/40 dark:text-white/40">
                  {t('article.sectionSources', { numbers: section.sources.join(', ') })}
                </p>
              ) : null}
            </section>
          ))}
        </div>

        {article.tags.length > 0 ? (
          <ul className="mt-8 flex flex-wrap gap-2">
            {article.tags.map((tag) => (
              <li key={tag}>
                {/* 태그는 목록을 좁히는 길이다 (7.3). 태그 목록 페이지는 두지 않는다 —
                    기사에서 눌러 들어오는 경로 하나면 된다 */}
                <Link
                  href={`/${locale}?tag=${encodeURIComponent(tag)}`}
                  className="block rounded-full bg-black/5 px-2.5 py-1 text-xs text-black/60 hover:text-black dark:bg-white/10 dark:text-white/60 dark:hover:text-white"
                >
                  {tag}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </article>

      {/* 출처는 기사의 일부다. 숨기지 않는다 (기획서 §2.2) */}
      <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">{t('article.sources')}</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {article.sources.map((source) => (
            <li key={source.ordinal} className="text-sm">
              <span className="text-black/40 dark:text-white/40">{source.ordinal}.</span>{' '}
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="hover:underline"
              >
                {source.title ?? source.url}
              </a>
              <span className="ml-2 text-xs text-black/40 dark:text-white/40">
                {source.publisher ? `${source.publisher} · ` : ''}
                {t('article.tier', { tier: source.tier })}
              </span>
            </li>
          ))}
        </ol>
      </section>

      {article.followedBy.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">{t('article.laterCoverage')}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {article.followedBy.map((later) => (
              <li key={later.slug} className="text-sm">
                <Link href={`/${locale}/articles/${later.slug}`} className="hover:underline">
                  {later.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ArticleFeedback
        articleId={article.id}
        styleGuideVersion={article.style_guide_version}
        locale={locale}
      />
    </div>
  );
}
