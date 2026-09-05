'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/db/supabase/server';

export type AuthState = { error: string } | null;

function readCredentials(formData: FormData) {
  return {
    email: String(formData.get('email') ?? '').trim(),
    password: String(formData.get('password') ?? ''),
  };
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: '이메일과 비밀번호를 입력하세요.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) return { error: '이메일과 비밀번호를 입력하세요.' };
  if (password.length < 6) return { error: '비밀번호는 6자 이상이어야 합니다.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/');
}
