'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/db/supabase/server';

/**
 * 로그인·가입·로그아웃 (로드맵 1.2).
 *
 * **문구가 아니라 코드를 돌려준다** (4.1). 서버 액션은 언어 세그먼트 밖에서도
 * 불릴 수 있어 여기서 번역을 고르면 언어가 어긋난다. 화면 문구는 폼이 고른다.
 */

export type AuthErrorCode = 'missing-fields' | 'weak-password' | 'rejected';

export type AuthState = { error: AuthErrorCode; detail?: string } | null;

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
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // detail 은 Supabase 가 준 영문 원문이다. 번역하지 않고 보조로만 보여준다 —
  // "Email not confirmed" 같은 구분은 일반 문구로 덮으면 사라진다
  if (error) return { error: 'rejected', detail: error.message };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: 'missing-fields' };
  if (password.length < 6) return { error: 'weak-password' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: 'rejected', detail: error.message };

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
