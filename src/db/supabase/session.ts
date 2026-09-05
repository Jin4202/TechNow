import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

import type { Database } from '@/db/types';
import type { NextRequest } from 'next/server';

/**
 * 요청마다 Supabase 세션 토큰을 갱신하고, 갱신된 쿠키를 응답에 실어 보낸다.
 *
 * 이걸 하지 않으면 브라우저 클라이언트는 토큰을 갱신하는데 서버 컴포넌트는
 * 만료된 토큰을 보게 되어, 로그인했는데 로그아웃 상태로 렌더되는 일이 생긴다.
 *
 * src/proxy.ts 에서 호출한다. 접근 게이트(7.7에서 제거)와 달리 이 부분은 남는다.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() 를 부르는 것 자체가 토큰 갱신을 유발한다.
  // getSession() 은 쿠키를 그대로 믿으므로 서버에서 쓰지 않는다
  await supabase.auth.getUser();

  return response;
}
