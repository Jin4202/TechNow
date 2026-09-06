'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { isLocale, LOCALE_COOKIE, type Locale } from '@/config/locales';
import { getProfile, updateLocale } from '@/db/profiles';
import { requestIdentifier, withinRateLimit } from '@/db/rate-limit';
import { createClient } from '@/db/supabase/server';

/**
 * 로그인·가입·로그아웃 (로드맵 1.2).
 *
 * **문구가 아니라 코드를 돌려준다** (4.1). 서버 액션은 언어 세그먼트 밖에서도
 * 불릴 수 있어 여기서 번역을 고르면 언어가 어긋난다. 화면 문구는 폼이 고른다.
 *
 * 로그인에 성공하면 프로필의 언어를 쿠키에 맞춘다 (4.2). 프로필이 원본이므로
 * 다른 기기에서 로그인해도 설정이 따라온다 — 그 기기의 쿠키가 무엇이었든.
 */

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

async function syncLocaleCookie(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
    sameSite: 'lax',
    httpOnly: false,
  });
}

export type AuthErrorCode = 'missing-fields' | 'weak-password' | 'rejected' | 'too-many';

/**
 * 폼이 보여줄 상태.
 *
 * 오류와 안내를 구분한다 — "메일을 확인하세요" 는 실패가 아닌데 빨간 글씨로
 * 띄우면 가입이 안 된 것처럼 보인다.
 */
export type AuthState =
  | { error: AuthErrorCode; detail?: string }
  | { notice: 'confirm-email' }
  | null;

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  };
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: 'missing-fields' };

  const supabase = await createClient();

  // 비밀번호 대입을 느리게 만든다 (7.2). 오타 몇 번은 통과하는 상한이다
  if (!(await withinRateLimit(supabase, 'auth', await requestIdentifier()))) {
    return { error: 'too-many' };
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // detail 은 Supabase 가 준 영문 원문이다. 번역하지 않고 보조로만 보여준다 —
  // "Email not confirmed" 같은 구분은 일반 문구로 덮으면 사라진다
  if (error) return { error: 'rejected', detail: error.message };

  const profile = await getProfile(supabase);
  if (profile) await syncLocaleCookie(profile.locale);

  revalidatePath('/', 'layout');
  // 언어 없는 경로다. proxy 가 방금 맞춘 쿠키를 보고 알맞은 언어로 돌린다
  redirect('/');
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: 'missing-fields' };
  if (password.length < 6) return { error: 'weak-password' };

  const supabase = await createClient();

  if (!(await withinRateLimit(supabase, 'auth', await requestIdentifier()))) {
    return { error: 'too-many' };
  }
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: 'rejected', detail: error.message };

  // **세션이 없으면 이메일 확인이 켜져 있다는 뜻이다.** 그대로 `/` 로 보내면
  // 가입이 실패한 것처럼 로그아웃 화면이 나온다 — 프로덕션에서 실제로 그랬다 (D-42).
  // 확인 메일을 보고 오라고 말해준다
  if (!data.session) return { notice: 'confirm-email' };

  // 가입 시점에 보고 있던 언어를 계정에 남긴다. 트리거가 만든 프로필은 기본값(en)이라
  // 한국어로 읽던 사람이 다른 기기에서 로그인하면 영어로 돌아가버린다.
  // 이메일 확인이 필요한 설정에서는 아직 세션이 없어 건너뛴다
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (data.user && cookieLocale && isLocale(cookieLocale)) {
    await updateLocale(supabase, data.user.id, cookieLocale);
  }

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  // 언어 없는 경로다. proxy 가 쿠키를 보고 알맞은 언어로 돌린다 (D-08)
  redirect('/');
}
