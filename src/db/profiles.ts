import type { Locale } from '@/config/locales';
import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 프로필 조회·수정 (로드맵 1.3, 4.2).
 *
 * anon 키 + RLS 로 동작한다. 정책이 본인 행만 허용하므로 여기서 user_id 를
 * 다시 걸지 않는다 — 걸어도 되지만, 접근 제어가 두 곳에 있으면 한 곳만 고치게 된다.
 */

export interface Profile {
  id: string;
  displayName: string | null;
  locale: Locale;
  premium: boolean;
}

export async function getProfile(db: SupabaseClient<Database>): Promise<Profile | null> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data, error } = await db
    .from('profiles')
    .select('id, display_name, locale, premium')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw new Error(`프로필 조회 실패: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    locale: data.locale,
    premium: data.premium,
  };
}

/**
 * 언어 설정 저장 (4.2).
 *
 * `profiles.locale` 이 원본이다 (D-08). 쿠키는 이 값의 사본이라
 * 이 함수를 부르는 쪽이 함께 갱신한다.
 */
export async function updateLocale(
  db: SupabaseClient<Database>,
  userId: string,
  locale: Locale,
): Promise<void> {
  const { error } = await db.from('profiles').update({ locale }).eq('id', userId);
  if (error) throw new Error(`언어 설정 저장 실패: ${error.message}`);
}
