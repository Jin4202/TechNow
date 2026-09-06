'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, useTransition } from 'react';

import { toggleScrapAction } from '@/app/[locale]/articles/actions';

import type { Locale } from '@/config/locales';

/**
 * 스크랩 버튼 (로드맵 6.1).
 *
 * 서버가 초기 상태를 넘겨준다 — 버튼이 깜빡이며 상태를 바꾸면 이미 담았는지
 * 아닌지 알 수 없다.
 *
 * **로그인하지 않은 독자에게도 보인다.** 기사 읽기에는 로그인이 필요 없으므로
 * (기획서 §2.7) 버튼을 숨기면 이런 기능이 있다는 것 자체를 모른다.
 * 누르면 로그인으로 안내한다.
 */
export function ScrapButton({
  articleId,
  locale,
  initiallyScrapped,
  loggedIn,
}: {
  articleId: string;
  locale: Locale;
  initiallyScrapped: boolean;
  loggedIn: boolean;
}) {
  const t = useTranslations('scraps');
  const [scrapped, setScrapped] = useState(initiallyScrapped);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!loggedIn || needsLogin) {
    return (
      <Link
        href={`/${locale}/login`}
        className="rounded-md border border-black/15 px-3 py-1.5 text-sm text-black/60 hover:text-black dark:border-white/20 dark:text-white/60 dark:hover:text-white"
      >
        {t('loginToScrap')}
      </Link>
    );
  }

  function toggle() {
    // 낙관적으로 바꾼다. 스크랩은 되돌리기 쉬운 동작이라
    // 서버를 기다리며 버튼이 굳어 있는 쪽이 더 나쁘다
    const next = !scrapped;
    setScrapped(next);

    startTransition(async () => {
      const { outcome } = await toggleScrapAction(articleId);

      // 세션이 만료된 경우. 눌린 것처럼 두면 저장된 줄 안다
      if (outcome === 'not-logged-in') {
        setScrapped(false);
        setNeedsLogin(true);
        return;
      }

      // 막혔거나 없는 기사면 눌린 상태를 되돌린다. 그대로 두면 담긴 줄 안다
      if (outcome === 'not-found' || outcome === 'rate-limited') setScrapped(false);
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={scrapped}
      className={
        scrapped
          ? 'rounded-md border border-black/15 bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:border-white/20 dark:bg-white dark:text-black'
          : 'rounded-md border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20'
      }
    >
      {scrapped ? t('unscrap') : t('scrap')}
    </button>
  );
}
