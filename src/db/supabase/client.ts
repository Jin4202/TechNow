'use client';

import { createBrowserClient } from '@supabase/ssr';

import type { Database } from '@/db/types';

/**
 * 브라우저용 Supabase 클라이언트.
 *
 * anon 키만 쓴다. 이 키는 공개되며, RLS가 유일한 방어선이다 (D-02).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
