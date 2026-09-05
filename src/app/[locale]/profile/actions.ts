'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { isLocale, LOCALE_COOKIE, swapLocale, type Locale } from '@/config/locales';
import { updateLocale } from '@/db/profiles';
import { createClient } from '@/db/supabase/server';

/**
 * 언어 변경 (로드맵 4.2, D-08).
 *
 * 세 가지를 한다:
 *   1. 로그인한 사용자면 `profiles.locale` 갱신 — 이쪽이 원본이고 기기를 넘어 따라온다
 *   2. `NEXT_LOCALE` 쿠키 갱신 — proxy 가 읽는 사본. 로그인하지 않은 독자도 유지된다
 *   3. 같은 페이지의 다른 언어판으로 이동
 *
 * 로그인을 요구하지 않는다. 기사 읽기에 로그인이 필요 없으므로(기획서 §2.7)
 * 언어 변경에만 요구하면 대부분의 독자가 언어를 바꿀 수 없다.
 */

/** 쿠키 수명. 다음 방문에도 같은 언어로 들어오는 것이 목적이라 길게 둔다 */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setLocale(locale: Locale, currentPath: string): Promise<void> {
  if (!isLocale(locale)) throw new Error(`지원하지 않는 언어: ${locale}`);

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    // 비밀이 아니다. 나중에 클라이언트에서 읽어야 할 수도 있으므로 잠그지 않는다
    httpOnly: false,
  });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) await updateLocale(supabase, user.id, locale);

  revalidatePath('/', 'layout');
  redirect(swapLocale(currentPath, locale));
}
