import Link from 'next/link';

import { logout } from '@/app/login/actions';
import { ArticleCard } from '@/components/article-card';
import { listPublishedArticles } from '@/db/published-articles';
import { createClient } from '@/db/supabase/server';

export default async function Home() {
  const supabase = await createClient();

  const [
    {
      data: { user },
    },
    articles,
  ] = await Promise.all([supabase.auth.getUser(), listPublishedArticles(supabase)]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">TechNow</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Science and technology, every morning
          </p>
        </div>

        {user ? (
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
            >
              Log out
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
          >
            Log in
          </Link>
        )}
      </header>

      <main>
        {articles.length === 0 ? (
          // 기획서 §2.1 — 임계값을 넘은 토픽이 없는 날
          <p className="py-16 text-center text-sm text-black/50 dark:text-white/50">
            No new stories today
          </p>
        ) : (
          <div>
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
