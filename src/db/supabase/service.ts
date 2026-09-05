import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/db/types';

/**
 * service_role 키를 쓰는 Supabase 클라이언트. **파이프라인 전용**.
 *
 * ⚠️ 이 클라이언트는 RLS를 우회한다. Next.js 앱에서 절대 import 하지 않는다
 * (CLAUDE.md §2.1). scripts/check-secrets.mjs 가 앱 코드에서의 사용을 CI에서 막는다.
 *
 * 앱은 anon 키 + RLS 로만 DB에 접근한다 (D-02).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다. ' +
        'Trigger.dev 환경변수를 확인하세요.',
    );
  }

  return createSupabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type ServiceClient = ReturnType<typeof createServiceClient>;
