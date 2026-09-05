import Link from 'next/link';
import { locale as rootLocale } from 'next/root-params';

import { toLocale } from '@/config/locales';

/**
 * 없는 기사, 지원하지 않는 언어.
 *
 * not-found 는 props 를 받지 않는다. 언어는 root parameter 라
 * `next/root-params` 로 직접 읽는다 (Next 16).
 */
export default async function NotFound() {
  // 지원하지 않는 언어로 들어와 404 가 된 경우도 있다. 그 값을 링크에 되쓰지 않는다
  const locale = toLocale((await rootLocale()) ?? '');

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-5 py-16 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        This page doesn&apos;t exist, or the article was unpublished.
      </p>
      <div>
        <Link
          href={`/${locale}`}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
        >
          Back to articles
        </Link>
      </div>
    </div>
  );
}
