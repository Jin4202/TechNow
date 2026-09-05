import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { BraveClient } from '@/clients/brave';
import { thresholds } from '@/config/thresholds';
import { recentRunCosts } from '@/db/pipeline-runs';
import { createServiceClient } from '@/db/supabase/service';
import { buildTopic } from '@/pipeline/build-topic';
import { publishReadyArticles } from '@/pipeline/publish/publish-ready';
import { runDailyDiscovery } from '@/pipeline/run-daily';

// 로컬 Supabase + 실제 피드 + 실제 Claude/Brave 호출.
// 기사를 실제로 만들므로 한 번에 $0.5 안팎. 실행: pnpm daily:live
const db = createServiceClient();
const claude = getAnthropic();
const brave = new BraveClient();

async function wipe() {
  await db.from('run_topics').delete().not('id', 'is', null);
  await db.from('source_texts').delete().not('id', 'is', null);
  await db.from('article_sources').delete().not('id', 'is', null);
  await db.from('articles').delete().not('id', 'is', null);
  await db.from('seen_feed_items').delete().not('url_hash', 'is', null);
  await db.from('pipeline_runs').delete().not('id', 'is', null);
}

beforeAll(wipe);
afterAll(wipe);

describe('일간 파이프라인 전체 (3.12, 3.13, 3.15)', () => {
  it('수집부터 기사 생성까지 돈다', async () => {
    const r = await runDailyDiscovery(db, claude, {
      // 테스트에서는 자식 태스크 대신 직접 부른다 (CLAUDE.md §3)
      buildTopic: (input) => buildTopic(db, claude, brave, input),
    });

    console.log(`\n수집 ${r.uniqueItems} → 후보 ${r.candidates} → 토픽 ${r.topics}`);
    console.log('선정:', r.selection);
    console.log(`생성 시도 ${r.buildAttempts}회 → 기사 ${r.articlesBuilt}건`);
    for (const f of r.buildFailures) {
      console.log(`  ✗ ${f.topicTitle.slice(0, 56)} — ${f.failure} ${f.detail.slice(0, 40)}`);
    }
    console.log(`고정비 $${r.costFixed} + 변동비 $${r.costVariable}`);
    console.log(
      `월 환산 $${r.projection.projectedMonthlyUsd} (편당 $${r.projection.variablePerArticle})`,
    );

    expect(r.failures).toEqual([]);
    expect(r.groupingFellBack).toBe(false);
    expect(r.articlesBuilt).toBeLessThanOrEqual(thresholds.dailyCap);

    // D-21: 조사가 실패하면 다음 순위로 내려간다.
    // 상한을 못 채웠다면 시도가 더 많았어야 한다
    if (r.articlesBuilt < thresholds.dailyCap) {
      expect(r.buildAttempts).toBeGreaterThan(r.articlesBuilt);
    }

    // 3.16: 비용이 로그가 아니라 DB 에 남아야 한다.
    // Trigger.dev 무료 티어 로그는 하루만 보관된다
    const [logged] = await recentRunCosts(db, 1);
    expect(logged!.status).toBe('success');
    expect(logged!.costFixed, '고정비는 기사 0건인 날에도 0 이 아니다').toBeGreaterThan(0);
    expect(logged!.costVariable).toBeGreaterThan(0);
    expect(logged!.inputTokens).toBeGreaterThan(0);
    expect(logged!.searchCalls).toBeGreaterThan(0);
    expect(logged!.costFixed).toBeCloseTo(r.costFixed, 4);
    expect(logged!.costVariable).toBeCloseTo(r.costVariable, 4);
  }, 1_800_000);

  it('기사가 출처와 함께 저장된다', async () => {
    const { data: articles } = await db
      .from('articles')
      .select('id, slug, status, body, style_guide_version, importance_score');

    console.log(`\n기사 ${articles!.length}건`);
    for (const a of articles!) {
      const { count } = await db
        .from('article_sources')
        .select('id', { count: 'exact', head: true })
        .eq('article_id', a.id);
      console.log(`  ${a.status} ${a.slug.slice(0, 50)} 출처 ${count}건 점수 ${a.importance_score}`);
      expect(count, '출처 없는 기사는 섹션 참조가 깨진다').toBeGreaterThanOrEqual(3);
    }

    // Phase 3 에서는 영문 본문만 필수이므로 바로 ready 다
    expect(articles!.every((a) => a.status === 'ready')).toBe(true);
    expect(articles!.every((a) => a.style_guide_version !== null)).toBe(true);

    // 섹션의 sources 가 실재하는 ordinal 을 가리키는지
    for (const a of articles!) {
      const { data: sources } = await db
        .from('article_sources')
        .select('ordinal')
        .eq('article_id', a.id);
      const known = new Set(sources!.map((s) => s.ordinal));
      const body = a.body as { sections: { sources: number[] }[] };
      for (const section of body.sections) {
        expect(section.sources.length).toBeGreaterThan(0);
        for (const ordinal of section.sources) expect(known).toContain(ordinal);
      }
    }
  });

  it('source_texts 가 저장되고 만료 시각이 있다 (D-05)', async () => {
    const { data } = await db.from('source_texts').select('expires_at, extracted_text').limit(5);
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((s) => new Date(s.expires_at) > new Date())).toBe(true);
    expect(data!.every((s) => s.extracted_text.length > 500)).toBe(true);
  });

  it('발행 태스크가 ready 를 published 로 넘긴다 (3.13)', async () => {
    const before = await db.from('articles').select('id', { count: 'exact', head: true }).eq('status', 'ready');
    const result = await publishReadyArticles(db);

    console.log(`\n발행 ${result.published}건, hold-back ${result.heldBack}, failed ${result.failed}`);
    expect(result.published).toBe(before.count);

    const { data: published } = await db.from('articles').select('status, published_at').eq('status', 'published');
    expect(published!.every((a) => a.published_at !== null), 'published 면 시각이 있어야 한다').toBe(true);

    // 두 번 불러도 이미 발행된 것을 다시 건드리지 않는다
    const second = await publishReadyArticles(db);
    expect(second.published).toBe(0);
  }, 300_000);
});
