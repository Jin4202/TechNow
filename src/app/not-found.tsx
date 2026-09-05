import Link from 'next/link';

/** 기사 상세 페이지는 3.14에서 붙는다. 그전까지 목록의 링크가 여기로 온다 */
export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-5 py-16 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        This page doesn&apos;t exist, or the article was unpublished.
      </p>
      <div>
        <Link
          href="/"
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
        >
          Back to articles
        </Link>
      </div>
    </div>
  );
}
