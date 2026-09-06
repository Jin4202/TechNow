import { headers } from 'next/headers';

import { rateLimits } from '@/config/rate-limits';

import type { ServiceClient } from '@/db/supabase/service';
import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Rate limiting (로드맵 7.2).
 *
 * 카운터는 DB 에 있다 — Vercel 서버리스는 인스턴스가 계속 바뀌어 메모리 카운터가
 * 아무것도 막지 못한다. 판정은 `check_rate_limit` (security definer) 이 하고,
 * 앱은 테이블에 직접 접근하지 않는다. 자기 카운터를 지울 수 있으면 상한이 아니다.
 *
 * **막히면 조용히 실패하지 않는다.** 호출하는 쪽이 사용자에게 "잠시 후 다시" 를
 * 보여줘야 한다. 아무 일도 없는 것처럼 두면 계속 두드린다.
 */

export type RateBucket = keyof typeof rateLimits;

/**
 * 요청자를 식별한다.
 *
 * 로그인 전 요청(가입·로그인)은 IP 밖에 없다. `x-forwarded-for` 의 **첫 번째**
 * 값을 쓴다 — 뒤쪽은 중간 프록시가 덧붙인 것이라 클라이언트가 위조할 수 있다.
 * Vercel 은 맨 앞에 실제 클라이언트 IP 를 넣는다.
 *
 * IP 를 못 얻으면 `unknown` 하나로 묶인다. 그 경우 상한을 공유하게 되지만,
 * 식별할 수 없는 요청을 무제한으로 두는 것보다 낫다.
 */
export async function requestIdentifier(): Promise<string> {
  const store = await headers();
  const forwarded = store.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();

  return first || store.get('x-real-ip') || 'unknown';
}

/**
 * 상한을 넘지 않았으면 true.
 *
 * **판정에 실패하면 통과시킨다.** DB 가 잠깐 흔들렸다고 로그인을 막으면
 * 장애가 두 배가 된다. rate limit 은 남용을 늦추는 것이지 인증이 아니다.
 */
export async function withinRateLimit(
  db: SupabaseClient<Database>,
  bucket: RateBucket,
  identifier: string,
): Promise<boolean> {
  const { max, windowSeconds } = rateLimits[bucket];

  const { data, error } = await db.rpc('check_rate_limit', {
    p_bucket: bucket,
    p_identifier: identifier,
    p_max: max,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error(`rate limit 판정 실패 (${bucket}): ${error.message}`);
    return true;
  }

  return data ?? true;
}

/**
 * 지난 윈도우의 카운터를 지운다 (일간 런의 정리 단계가 부른다).
 *
 * 고정 윈도우라 창이 지나면 그 행은 쓸모가 없다. 지우지 않으면
 * 요청자 × 윈도우만큼 영구히 쌓인다.
 *
 * 서비스 키로만 부른다 — 앱이 카운터를 지울 수 있으면 상한이 아니다.
 */
export async function cleanupRateLimits(db: ServiceClient, olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('rate_limits')
    .delete()
    .lt('window_start', cutoff)
    .select('bucket');

  if (error) throw new Error(`rate limit 정리 실패: ${error.message}`);
  return data?.length ?? 0;
}
