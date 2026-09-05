'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import { login, signUp, type AuthState } from './actions';

type Mode = 'login' | 'signup';

export default function LoginPage() {
  const t = useTranslations('auth');
  const [mode, setMode] = useState<Mode>('login');
  const action = mode === 'login' ? login : signUp;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(action, null);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">TechNow</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          {mode === 'login' ? t('logInHeading') : t('signUpHeading')}
        </p>
      </div>

      <div
        className="flex rounded-lg border border-black/10 p-1 dark:border-white/15"
        role="tablist"
      >
        {(['login', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${
              mode === m
                ? 'bg-black text-white dark:bg-white dark:text-black'
                : 'text-black/60 dark:text-white/60'
            }`}
          >
            {m === 'login' ? t('logIn') : t('signUp')}
          </button>
        ))}
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          {t('email')}
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border border-black/15 bg-transparent px-3 py-2 text-base dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {t('password')}
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
            className="rounded-md border border-black/15 bg-transparent px-3 py-2 text-base dark:border-white/20"
          />
        </label>

        {state ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t(`errors.${state.error}`)}
            {/* Supabase 가 준 영문 원문. 왜 거절됐는지는 이쪽에만 남는다 */}
            {state.detail ? (
              <span className="mt-1 block text-xs text-black/50 dark:text-white/50">
                {state.detail}
              </span>
            ) : null}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {pending ? t('submitting') : mode === 'login' ? t('logInSubmit') : t('signUpSubmit')}
        </button>
      </form>
    </main>
  );
}
