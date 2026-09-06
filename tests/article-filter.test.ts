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
    gte(column: string, value: string) {
      calls.push(`gte:${column}=${value}`);
      return chain;
    },
    lt(column: string, value: string) {
      calls.push(`lt:${column}=${value}`);
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

describe('월 필터 (7.8)', () => {
  it('그달 시작과 다음달 시작으로 범위를 건다', async () => {
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en', { month: '2026-09' });

    expect(calls).toContain('gte:published_at=2026-09-01T07:00:00.000Z');
    expect(calls).toContain('lt:published_at=2026-10-01T07:00:00.000Z');
  });

  it('형식이 틀리면 조건을 걸지 않는다', async () => {
    // 부르는 쪽이 이미 404 를 내므로 여기까지 오면 안 되지만,
    // 온다면 전체를 보여주는 편이 낫다 — 잘못된 범위로 자르는 것보다
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en', { month: '2026-13' });

    expect(calls.some((c) => c.startsWith('gte:'))).toBe(false);
  });

  it('월 필터와 카테고리를 같이 걸 수 있다', async () => {
    const { db, calls } = fakeDb();
    await listPublishedArticles(db, 'en', { month: '2026-09', category: 'ai-computing' });

    expect(calls).toContain('eq:category=ai-computing');
    expect(calls.some((c) => c.startsWith('gte:'))).toBe(true);
  });
});
