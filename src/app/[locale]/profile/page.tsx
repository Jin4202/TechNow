import { getTranslations, setRequestLocale } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { toLocale } from '@/config/locales';
import { getProfile } from '@/db/profiles';
import { createClient } from '@/db/supabase/server';

/**
 * 프로필 (로드맵 4.2).
 *
 * 지금 있는 설정은 언어 하나다. 스크랩 폴더(6.2)와 월간 요약(6.7)이 여기 붙는다.
 */
export default async function ProfilePage({ params }: PageProps<'/[locale]/profile'>) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations();
  const supabase = await createClient();
  const [profile, { data: auth }] = await Promise.all([getProfile(supabase), supabase.auth.getUser()]);

  // 프로필은 본인 것만 있다. 로그인하지 않았으면 볼 것이 없다
  if (!profile) redirect(`/${locale}/login`);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-10 sm:px-6 sm:py-16">
      <nav>
        <Link href={`/${locale}`} className="text-sm text-black/60 hover:underline dark:text-white/60">
          {t('nav.allArticles')}
        </Link>
      </nav>

      <main className="flex flex-col gap-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('profile.title')}</h1>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t('profile.language')}</h2>
          <p className="text-sm text-black/60 dark:text-white/60">{t('profile.languageHelp')}</p>
          <div className="mt-1">
            <LocaleSwitcher current={profile.locale} />
          </div>
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">{t('profile.account')}</h2>
          <p className="text-sm text-black/60 dark:text-white/60">{auth.user?.email}</p>
        </section>
      </main>
    </div>
  );
}
