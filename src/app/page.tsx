import Link from 'next/link';

import { logout } from '@/app/login/actions';
import { createClient } from '@/db/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">TechNow</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            과학·기술 뉴스, 매일 아침
          </p>
        </div>

        {user ? (
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
            >
              로그아웃
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
          >
            로그인
          </Link>
        )}
      </header>

      <section className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/15">
        {user ? (
          <p>
            <span className="text-black/60 dark:text-white/60">로그인됨 </span>
            <span className="font-medium">{user.email}</span>
          </p>
        ) : (
          <p className="text-black/60 dark:text-white/60">
            로그인하지 않았습니다. 기사 읽기에는 로그인이 필요 없고, 스크랩에는 필요합니다.
          </p>
        )}
      </section>

      <p className="text-sm text-black/50 dark:text-white/50">
        기사 목록은 1.12에서 붙습니다.
      </p>
    </main>
  );
}
