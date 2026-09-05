'use client';

import { useTranslations } from 'next-intl';

/**
 * 렌더 중 예외가 났을 때의 화면.
 *
 * 이게 없으면 DB 연결 실패 같은 상황에서 raw 500 이 뜬다.
 * 주의: "No new stories today" 로 대체하면 안 된다 — 기사가 없는 것과
 * 읽지 못한 것은 다르고, 후자를 전자처럼 보여주면 독자를 속이는 셈이다.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('error');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-5 py-16 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        {t('body')}
      </p>
      <div>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
        >
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
