import { NextResponse } from 'next/server';

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from '@/config/locales';
import { updateSession } from '@/db/supabase/session';

import type { NextRequest } from 'next/server';

/**
 * 언어 리다이렉트와 세션 갱신 (D-08, 로드맵 4.0).
 *
 * **접근 게이트(basic auth)가 여기 있었고 7.7 에서 걷어냈다** (2026-09-09, 1차 공개).
 * 사이트는 이제 누구나 볼 수 있다. 비공개로 지켜야 할 것을 막는 것은 게이트가
 * 아니라 RLS 다 — 발행 전 기사는 anon 키로 조회되지 않는다 (D-02, 7.6a 에서
 * 검사 19개로 확인). 게이트는 "아직 보여줄 때가 아니다" 를 위한 것이었지
 * 방어선이 아니었다.
 *
 * Next 16에서 `middleware.ts` 규약은 `proxy.ts` 로 이름이 바뀌었다.
 * proxy 는 렌더 코드와 분리 실행되므로 여기서 만든 전역 상태를 앱이 볼 수 있다고
 * 가정하면 안 된다. 정보 전달은 헤더·쿠키·리다이렉트로만 한다.
 *
 * 이 파일은 두 가지를 한다:
 *   1. 언어 없는 경로의 리다이렉트 (D-08)
 *   2. Supabase 세션 갱신
 */

/**
 * 언어 없는 경로를 언어 있는 경로로 돌린다 (D-08, 로드맵 4.0).
 *
 * 순수 함수다. 이미 언어가 붙어 있으면 `null` 을 돌려준다.
 *
 * **기본값은 쿠키에서 읽는다.** `profiles.locale` 이 원본이지만(D-08) 리다이렉트
 * 하나에 DB 왕복을 붙이지 않는다. 프로필을 바꿀 때와 로그인할 때 쿠키를 맞춘다 (4.2).
 * 로그인하지 않은 독자도 선택이 유지되어야 하므로 쿠키가 맞는 자리다.
 *
 * next-intl 의 미들웨어를 쓰지 않는 이유: 이 파일에 이미 basic auth 와 Supabase
 * 쿠키 갱신이 있고, 세 가지를 한 응답에 합치는 것보다 접두사가 없을 때만
 * 리다이렉트하는 함수 하나가 단순하고 테스트된다.
 */
export function localeRedirect(
  pathname: string,
  hints: { cookie?: string; acceptLanguage?: string | null },
): string | null {
  const [, first = ''] = pathname.split('/');
  if (isLocale(first)) return null;

  // 파일처럼 생긴 경로는 언어를 붙이지 않는다. robots.txt, sitemap.xml,
  // 정적 자산은 언어판이 없고, `/en/robots.txt` 로 돌리면 그냥 404 가 된다
  if (pathname.slice(pathname.lastIndexOf('/')).includes('.')) return null;

  const target = pickLocale(hints);
  // 루트는 `//` 가 되지 않도록. 나머지는 접두사만 붙인다
  return pathname === '/' ? `/${target}` : `/${target}${pathname}`;
}

function pickLocale(hints: { cookie?: string; acceptLanguage?: string | null }): Locale {
  if (hints.cookie && isLocale(hints.cookie)) return hints.cookie;

  // Accept-Language 는 `ko-KR,ko;q=0.9,en;q=0.8` 처럼 온다.
  // q 값 정렬까지 하지 않는다 — 브라우저는 선호 순으로 보내고, 우리 선택지는 둘뿐이다
  for (const part of (hints.acceptLanguage ?? '').split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    const base = tag.split('-')[0] ?? '';
    if (isLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // 리다이렉트 판정이 세션 갱신보다 앞이다. 리다이렉트될 요청의 세션을 갱신해봐야
  // 그 응답은 버려진다
  const target = localeRedirect(request.nextUrl.pathname, {
    cookie: request.cookies.get(LOCALE_COOKIE)?.value,
    acceptLanguage: request.headers.get('accept-language'),
  });

  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
    // **307 이지 308 이 아니다.** 목적지가 쿠키에 따라 달라지므로 영구 리다이렉트로
    // 내면 브라우저가 그것을 캐시해, 언어를 바꿔도 `/` 가 계속 옛 언어로 간다.
    // 실제로 그렇게 만들었다가 잡았다. 307 은 메서드를 유지하면서 임시다
    return NextResponse.redirect(url, 307);
  }

  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
