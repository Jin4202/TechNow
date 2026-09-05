import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from '@/db/types';

/**
 * 서버 컴포넌트 / 서버 액션 / 라우트 핸들러용 Supabase 클라이언트.
 *
 * anon 키 + 사용자 세션 쿠키로 동작한다. RLS가 그대로 적용되므로
 * 이 클라이언트로는 발행된 기사와 본인 소유 행만 보인다.
 *
 * 파이프라인이 쓰는 service_role 클라이언트는 여기 두지 않는다 (CLAUDE.md §2.1).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // 서버 컴포넌트에서는 쿠키를 쓸 수 없다.
            // proxy 가 세션을 갱신하므로 여기서는 무시해도 된다
          }
        },
      },
    },
  );
}
