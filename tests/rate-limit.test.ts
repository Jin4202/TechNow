import { describe, expect, it, vi } from 'vitest';

import { rateLimits } from '@/config/rate-limits';
import { withinRateLimit } from '@/db/rate-limit';

import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Rate limit 판정 (로드맵 7.2).
 *
 * 상한 자체는 DB 함수가 센다. 여기서 지키는 것은 **호출 규약**이다 —
 * 잘못된 인자를 넘기면 아무것도 막지 못하면서 막고 있다고 믿게 된다.
 */

function fakeDb(result: { data?: boolean | null; error?: { message: string } | null }) {
  const calls: Record<string, unknown>[] = [];

  const db = {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data: result.data ?? null, error: result.error ?? null };
    },
  };

  return { db: db as unknown as SupabaseClient<Database>, calls };
}

describe('withinRateLimit', () => {
  it('config 의 상한과 창을 그대로 넘긴다', async () => {
    const { db, calls } = fakeDb({ data: true });
    await withinRateLimit(db, 'auth', '1.2.3.4');

    expect(calls[0]).toEqual({
      p_bucket: 'auth',
      p_identifier: '1.2.3.4',
      p_max: rateLimits.auth.max,
      p_window_seconds: rateLimits.auth.windowSeconds,
    });
  });

  it('상한을 넘으면 false', async () => {
    const { db } = fakeDb({ data: false });
    expect(await withinRateLimit(db, 'auth', '1.2.3.4')).toBe(false);
  });

  it('판정이 실패하면 통과시킨다', async () => {
    // DB 가 흔들렸다고 로그인을 막으면 장애가 두 배가 된다.
    // rate limit 은 남용을 늦추는 것이지 인증이 아니다
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = fakeDb({ error: { message: 'connection reset' } });

    expect(await withinRateLimit(db, 'auth', '1.2.3.4')).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('버킷마다 상한이 다르다', async () => {
    const { db, calls } = fakeDb({ data: true });
    await withinRateLimit(db, 'scrap', 'user-1');

    expect(calls[0]!.p_max).toBe(rateLimits.scrap.max);
    expect(calls[0]!.p_max).not.toBe(rateLimits.auth.max);
  });
});

describe('rateLimits config', () => {
  it('인증이 스크랩보다 빡빡하다', () => {
    const authPerSecond = rateLimits.auth.max / rateLimits.auth.windowSeconds;
    const scrapPerSecond = rateLimits.scrap.max / rateLimits.scrap.windowSeconds;

    expect(authPerSecond).toBeLessThan(scrapPerSecond);
  });

  it('사람의 정상 사용을 막지 않는다', () => {
    // 로그인 오타 3~4번, 목록 훑으며 스크랩 20개는 통과해야 한다
    expect(rateLimits.auth.max).toBeGreaterThanOrEqual(5);
    expect(rateLimits.scrap.max).toBeGreaterThanOrEqual(20);
  });
});
