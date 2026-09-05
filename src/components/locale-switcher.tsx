'use client';

import { usePathname } from 'next/navigation';
import { useTransition } from 'react';

import { setLocale } from '@/app/[locale]/profile/actions';
import { LOCALES, type Locale } from '@/config/locales';

/**
 * 언어 전환 (로드맵 4.2).
 *
 * 링크가 아니라 서버 액션인 이유: 언어를 바꾸는 것은 이동만이 아니라
 * **선택을 남기는 것**이다. 쿠키와 (로그인했다면) 프로필을 갱신해야
 * 다음에 `/` 로 들어와도 같은 언어가 나온다 (D-08).
 *
 * 현재 경로는 클라이언트만 안다. 서버 액션에 그대로 넘겨 같은 페이지의
 * 다른 언어판으로 보낸다.
 */

const LABELS: Record<Locale, string> = {
  en: 'EN',
  ko: '한국어',
};

export function LocaleSwitcher({ current }: { current: Locale }) {
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1 text-xs">
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          // 현재 언어를 다시 눌러도 막지 않는다. 쿠키가 없던 독자에게는
          // 그 클릭이 선택을 남기는 유일한 방법이다
          aria-current={locale === current ? 'true' : undefined}
          disabled={pending}
          onClick={() => startTransition(() => setLocale(locale, pathname))}
          className={
            locale === current
              ? 'rounded-md bg-black/5 px-2 py-1 font-medium disabled:opacity-50 dark:bg-white/10'
              : 'rounded-md px-2 py-1 text-black/50 hover:text-black disabled:opacity-50 dark:text-white/50 dark:hover:text-white'
          }
        >
          {LABELS[locale]}
        </button>
      ))}
    </div>
  );
}
