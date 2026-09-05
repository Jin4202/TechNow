import { NextResponse } from 'next/server';

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from '@/config/locales';
import { updateSession } from '@/db/supabase/session';

import type { NextRequest } from 'next/server';

/**
 * 접근 게이트 (로드맵 0.5).
 *
 * Phase 7 이전까지 사이트는 공개되지 않는다. 7.7에서 이 파일을 제거한다.
 *
 * Next 16에서 `middleware.ts` 규약은 `proxy.ts` 로 이름이 바뀌었다.
 * proxy 는 렌더 코드와 분리 실행되므로 여기서 만든 전역 상태를 앱이 볼 수 있다고
 * 가정하면 안 된다. 정보 전달은 헤더·쿠키·리다이렉트로만 한다.
 *
 * 이 파일은 세 가지를 한다:
 *   1. 접근 게이트 (basic auth) — 7.7에서 제거한다
 *   2. 언어 없는 경로의 리다이렉트 (D-08) — 계속 남는다
 *   3. Supabase 세션 갱신 — 계속 남는다
 */

const REALM = 'TechNow';

/** 길이는 노출되지만 내용 비교는 조기 종료하지 않는다 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type GateResult =
  /** 통과 */
  | 'allow'
  /** 자격증명 요구 (401) */
  | 'challenge'
  /** 게이트 자체가 설정되지 않음 (503). 프로덕션에서 통과시키지 않는다 */
  | 'misconfigured';

export interface GateEnv {
  user: string | undefined;
  password: string | undefined;
  isDevelopment: boolean;
}

/**
 * 순수 판정 함수. NextRequest 없이 테스트할 수 있도록 분리했다.
 */
export function checkGate(authorizationHeader: string | null, env: GateEnv): GateResult {
  const { user, password, isDevelopment } = env;

  // 게이트의 목적은 배포본을 비공개로 두는 것이다. 로컬 개발 서버에는 의미가 없고
  // 매 요청 자격증명을 요구하면 작업만 방해한다
  if (isDevelopment) return 'allow';

  if (!user || !password) {
    // 설정 누락이 게이트 해제로 이어지면 안 된다 (fail closed)
    return 'misconfigured';
  }

  if (!authorizationHeader?.startsWith('Basic ')) return 'challenge';

  let decoded: string;
  try {
    decoded = atob(authorizationHeader.slice('Basic '.length));
  } catch {
    return 'challenge';
  }

  const separator = decoded.indexOf(':');
  if (separator === -1) return 'challenge';

  // 사용자명이 틀려도 비밀번호 비교를 건너뛰지 않는다
  const userOk = constantTimeEquals(decoded.slice(0, separator), user);
  const passwordOk = constantTimeEquals(decoded.slice(separator + 1), password);

  return userOk && passwordOk ? 'allow' : 'challenge';
}

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
  const result = checkGate(request.headers.get('authorization'), {
    user: process.env.GATE_USER,
    password: process.env.GATE_PASSWORD,
    isDevelopment: process.env.NODE_ENV === 'development',
  });

  if (result === 'allow') {
    // 게이트 다음, 세션 갱신 앞이다. 리다이렉트될 요청의 세션을 갱신해봐야
    // 그 응답은 버려진다
    const target = localeRedirect(request.nextUrl.pathname, {
      cookie: request.cookies.get(LOCALE_COOKIE)?.value,
      acceptLanguage: request.headers.get('accept-language'),
    });

    if (target) {
      const url = request.nextUrl.clone();
      url.pathname = target;
      // 308: 영구이고 메서드를 유지한다. 언어 접두사는 앞으로도 바뀌지 않는다
      return NextResponse.redirect(url, 308);
    }

    return updateSession(request);
  }

  if (result === 'misconfigured') {
    return new NextResponse(
      '접근 게이트가 설정되지 않았습니다. GATE_USER 와 GATE_PASSWORD 를 등록하세요.',
      { status: 503 },
    );
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

export const config = {
  // 정적 자산까지 막으면 401 화면의 CSS/JS 로딩이 깨진다
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
