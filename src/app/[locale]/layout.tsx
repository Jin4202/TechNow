import { NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { isLocale, LOCALES } from '@/config/locales';

import '../globals.css';

import type { Metadata } from 'next';

/**
 * 루트 레이아웃. 언어 세그먼트 **안**에 있다 (D-08, D-13).
 *
 * Next 16 은 루트 레이아웃이 동적 세그먼트 아래 있는 것을 지원하고, 그 세그먼트를
 * **root parameter** 로 다룬다 — 깊은 서버 컴포넌트에서는 `next/root-params` 의
 * `locale()` 로 props 드릴링 없이 읽을 수 있다.
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md)
 *
 * 폰트는 Pretendard 하나로 두 언어를 다 쓴다 (기획서 §7). 라틴 문자와 한글이
 * 같은 폰트에서 나와야 언어를 바꿔도 지면이 흔들리지 않는다.
 */

export const metadata: Metadata = {
  title: 'TechNow',
  description: 'Original science and technology reporting, researched and published daily.',
};

/**
 * `/xx/...` 처럼 지원하지 않는 언어로 들어오면 404 다.
 *
 * 이 검증이 없으면 아무 문자열이나 언어로 받아들여져 같은 내용이 무한한 URL 로
 * 서빙된다. 언어 없는 경로의 리다이렉트는 proxy 가 앞에서 처리한다.
 */
export default async function RootLayout({ children, params }: LayoutProps<'/[locale]'>) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // 이게 없으면 next-intl 이 요청별 렌더로 내려가 정적 생성이 깨진다
  setRequestLocale(locale);

  return (
    <html lang={locale} className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

/** 두 언어 모두 정적으로 알려진 값이다 */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}
