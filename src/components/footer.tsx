import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

import { CONTACT_EMAIL } from '@/config/site';

import type { Locale } from '@/config/locales';

/**
 * 사이트 푸터 (로드맵 7.1).
 *
 * 레이아웃의 `<body>` 가 `flex min-h-full flex-col` 이고 모든 페이지의 최상위
 * div 가 `flex-1` 이라, 여기는 CSS 없이 바닥에 붙는다.
 *
 * **계정 관련 링크를 넣지 않는다** (7.0c). 1차 공개에서 로그인이 잠겨 있고,
 * 링크를 남겨두면 눌러서 404 를 만나게 된다.
 *
 * 문의 주소는 `CONTACT_EMAIL` 이 비어 있으면 **항목 자체가 사라진다.**
 * 가짜 주소를 넣어두는 것보다 안 보이는 쪽이 안전하다.
 */
export async function Footer({ locale }: { locale: Locale }) {
  const t = await getTranslations();

  return (
    <footer className="border-t border-black/10 dark:border-white/10">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-6 text-sm text-black/50 sm:px-6 dark:text-white/50">
        <span>{t('site.name')}</span>

        <nav className="flex items-center gap-4">
          <Link href={`/${locale}/about`} className="hover:underline">
            {t('footer.about')}
          </Link>

          {CONTACT_EMAIL ? (
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:underline">
              {t('footer.contact')}
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
