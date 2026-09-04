import { NextResponse } from 'next/server';

import type { NextRequest } from 'next/server';

/**
 * 접근 게이트 (로드맵 0.5).
 *
 * Phase 7 이전까지 사이트는 공개되지 않는다. 7.7에서 이 파일을 제거한다.
 *
 * Next 16에서 `middleware.ts` 규약은 `proxy.ts` 로 이름이 바뀌었다.
 * 또한 proxy 는 CDN에 배포될 수 있어 공유 모듈이나 전역 상태에 의존하면 안 되므로,
 * src/config/env.ts 를 쓰지 않고 process.env 를 직접 읽는다.
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

  if (!user || !password) {
    // 설정 누락이 게이트 해제로 이어지면 안 된다 (fail closed).
    // 로컬 개발만 예외로 통과시킨다.
    return isDevelopment ? 'allow' : 'misconfigured';
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

export function proxy(request: NextRequest): NextResponse {
  const result = checkGate(request.headers.get('authorization'), {
    user: process.env.GATE_USER,
    password: process.env.GATE_PASSWORD,
    isDevelopment: process.env.NODE_ENV === 'development',
  });

  if (result === 'allow') return NextResponse.next();

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
