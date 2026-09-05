import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServiceClient } from '@/db/supabase/service';
import { runDailyDiscovery } from '@/pipeline/run-daily';

// 로컬 Supabase 스택 + 실제 피드를 탄다.
// 실행: pnpm daily:live
const db = createServiceClient();

async function wipe() {
  await db.from('articles').delete().not('id', 'is', null);
  await db.from('seen_feed_items').delete().not('url_hash', 'is', null);
  await db.from('pipeline_runs').delete().not('id', 'is', null);
}

beforeAll(wipe);
afterAll(wipe);

describe('일간 파이프라인 (1.9, 1.10)', () => {
  it('첫 런: 항목을 기록하고 placeholder 기사를 만든다', async () => {
    const r = await runDailyDiscovery(db);

    expect(r.failures).toEqual([]);
    expect(r.uniqueItems).toBeGreaterThan(80);
    // 처음이므로 전부 신규
    expect(r.candidates).toBe(r.uniqueItems);
    expect(r.newlyRecorded).toBe(r.uniqueItems);
    expect(r.resumed).toBe(0);
    expect(r.skipped).toBe(0);
    // 일 상한만큼만 기사로
    expect(r.published).toBe(3);

    const { count } = await db.from('articles').select('id', { count: 'exact', head: true });
    expect(count).toBe(3);
  }, 90_000);

  it('두 번째 런: 이미 처리한 항목은 다시 후보가 되지 않는다', async () => {
    const r = await runDailyDiscovery(db);

    // 앞선 런이 전부 processed 로 넘겼다
    expect(r.skipped).toBeGreaterThan(80);
    expect(r.candidates).toBe(0);
    expect(r.published).toBe(0);

    // 기사가 늘지 않는다
    const { count } = await db.from('articles').select('id', { count: 'exact', head: true });
    expect(count).toBe(3);
  }, 90_000);

  it('pipeline_runs 에 런마다 한 행이 남는다 (1.10)', async () => {
    const { data } = await db
      .from('pipeline_runs')
      .select('run_type, status, topics_seen, topics_selected, articles_published, notes, finished_at')
      .order('started_at', { ascending: true });

    expect(data).toHaveLength(2);
    expect(data!.every((r) => r.run_type === 'daily')).toBe(true);
    expect(data!.every((r) => r.status === 'success')).toBe(true);
    expect(data!.every((r) => r.finished_at !== null)).toBe(true);

    expect(data![0]!.articles_published).toBe(3);
    expect(data![0]!.topics_selected).toBe(3);
    expect(data![0]!.topics_seen).toBeGreaterThan(80);

    expect(data![1]!.articles_published).toBe(0);
    expect(data![1]!.topics_seen).toBe(0);
    expect(data![0]!.notes).toContain('수집');
  });

  it('placeholder 기사가 published 라 anon 에게 보인다', async () => {
    const { data } = await db.from('articles').select('slug, category, status, body').limit(3);

    expect(data!.every((a) => a.status === 'published')).toBe(true);
    expect(data!.every((a) => a.slug.length > 0)).toBe(true);
    // DB check 제약을 통과한 body 구조
    expect(data!.every((a) => Array.isArray((a.body as { sections: unknown[] }).sections))).toBe(true);
  });

  it('런이 실패해도 pipeline_runs 에 failed 로 남는다', async () => {
    // startRun 은 되지만 이후가 깨지도록 잘못된 클라이언트를 흉내낸다
    const broken = {
      ...db,
      from: (table: string) => {
        if (table === 'seen_feed_items') throw new Error('의도된 실패');
        return db.from(table as 'pipeline_runs');
      },
    } as unknown as typeof db;

    await expect(runDailyDiscovery(broken)).rejects.toThrow('의도된 실패');

    const { data } = await db
      .from('pipeline_runs')
      .select('status, notes')
      .eq('status', 'failed');

    expect(data).toHaveLength(1);
    expect(data![0]!.notes).toContain('의도된 실패');
  }, 90_000);
});
