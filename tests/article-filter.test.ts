import { describe, expect, it } from 'vitest';

import { listPublishedArticles } from '@/db/published-articles';

import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 목록 필터 (로드맵 7.3).
 *
 * 확인하는 것은 **어떤 조건이 질의에 실렸는가** 다. 필터가 조용히 빠지면
 * 사용자는 좁힌 줄 알지만 전체를 보게 된다.
 */

function fakeDb() {
  const calls: string[] = [];

  const chain = {
    eq(column: string, value: string) {
      calls.push(`eq:${column}=${value}`);
      return chain;
    },
    contains(column: string, value: string[]) {
      calls.push(`contains:${column}=${value.join(',')}`);
      return chain;
    },
    order() {
      return chain;
    },
    limit(n: number) {
      calls.push(`limit:${n}`);
      return Promise.resolve({ data: [], error: null });
    },
  };

  const db = { from: () => ({ select: () => chain }) };
  return { db: db as unknown as SupabaseClient<Database>, calls };
}

describe('listPublishedArticles 필터', () => {
  it('필터가 없으면 발행 상태만 건다', async () => {
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en');

    expect(calls).toContain('eq:status=published');
    expect(calls.some((c) => c.startsWith('contains:'))).toBe(false);
  });

  it('카테고리를 건다', async () => {
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en', { category: 'space-astronomy' });

    expect(calls).toContain('eq:category=space-astronomy');
  });

  it('태그는 배열 포함으로 건다', async () => {
    // tags 는 text[] 라 eq 로는 못 찾는다
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en', { tag: 'nuclear' });

    expect(calls).toContain('contains:tags=nuclear');
  });

  it('둘 다 주면 둘 다 건다', async () => {
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en', { category: 'space-astronomy', tag: 'nuclear' });

    expect(calls).toContain('eq:category=space-astronomy');
    expect(calls).toContain('contains:tags=nuclear');
  });

  it('한국어 목록에도 같은 필터가 걸린다', async () => {
    // 번역 조인 질의는 경로가 다르다. 여기가 빠지면 한국어에서만 필터가 안 먹는다
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'ko', { category: 'space-astronomy' });

    expect(calls).toContain('eq:article_translations.locale=ko');
    expect(calls).toContain('eq:category=space-astronomy');
  });

  it('기본 상한은 30이다', async () => {
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en');

    expect(calls).toContain('limit:30');
  });
});
