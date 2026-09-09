import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';

import { LOCALES, toLocale } from '@/config/locales';
import { CONTACT_EMAIL } from '@/config/site';

/**
 * 소개 (로드맵 7.1).
 *
 * **이 페이지의 존재 이유는 "기사가 어떻게 만들어지는가" 를 밝히는 것이다.**
 * 지금까지 그 설명이 사이트 어디에도 없었다 — 커버에만 "AI Generated" 배지가
 * 붙어 있고 본문이 기계로 쓰인다는 사실은 적혀 있지 않았다.
 *
 * `limits` 절을 빼지 않는다. 근거 검증을 자랑하면서 사람이 검수하지 않는다는
 * 사실을 감추면 그게 더 나쁘다.
 *
 * 1차 공개에서는 개인정보 안내도 여기 한 절로 둔다. 계정이 없어 받는 것이
 * 적은데 페이지를 따로 파면 내용보다 형식이 커진다. 계정이 생기는 2차에
 * 이용약관과 함께 `/privacy` 로 분리한다.
 */

/** 렌더 순서. 메시지 키와 1:1 이고, 순서가 곧 읽는 순서다 */
const SECTIONS = ['what', 'how', 'notDoing', 'limits', 'accounts', 'privacy'] as const;

export async function generateMetadata({ params }: PageProps<'/[locale]/about'>) {
  const locale = toLocale((await params).locale);
  const t = await getTranslations();

  return {
    title: t('about.title'),
    description: t('about.intro'),
    alternates: {
      canonical: `/${locale}/about`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}/about`])),
    },
  };
}

export default async function AboutPage({ params }: PageProps<'/[locale]/about'>) {
  const locale = toLocale((await params).locale);
  // 이게 없으면 next-intl 이 요청별 렌더로 내려가 정적 생성이 깨진다
  setRequestLocale(locale);

  const t = await getTranslations();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t('about.title')}</h1>
        <Link
          href={`/${locale}`}
          className="text-sm text-black/60 hover:underline dark:text-white/60"
        >
          {t('nav.allArticles')}
        </Link>
      </header>

      <main className="flex flex-col gap-8">
        <p className="text-base">{t('about.intro')}</p>

        {SECTIONS.map((section) => (
          <section key={section} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t(`about.sections.${section}.title`)}</h2>
            <p className="text-sm leading-relaxed text-black/60 dark:text-white/60">
              {t(`about.sections.${section}.body`)}
            </p>

            {/* 만드는 방법을 설명한 바로 뒤에 둔다. 절을 따로 만들면 넘겨 읽힌다 */}
            {section === 'how' ? (
              <p className="text-sm font-medium">{t('about.aiNotice')}</p>
            ) : null}
          </section>
        ))}

        {CONTACT_EMAIL ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t('about.contact.title')}</h2>
            <p className="text-sm leading-relaxed text-black/60 dark:text-white/60">
              {t('about.contact.body')}{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
                {CONTACT_EMAIL}
              </a>
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
