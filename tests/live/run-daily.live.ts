import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { thresholds } from '@/config/thresholds';
import { createServiceClient } from '@/db/supabase/service';
import { runDailyDiscovery } from '@/pipeline/run-daily';

// 로컬 Supabase + 실제 피드 + 실제 Claude 호출. 한 번에 15센트 안팎.
// 실행: pnpm daily:live
const db = createServiceClient();
const claude = getAnthropic();

async function wipe() {
  await db.from('run_topics').delete().not('id', 'is', null);
  await db.from('articles').delete().not('id', 'is', null);
  await db.from('seen_feed_items').delete().not('url_hash', 'is', null);
  await db.from('pipeline_runs').delete().not('id', 'is', null);
}

beforeAll(wipe);
afterAll(wipe);

describe('일간 파이프라인 전체 (Phase 1 + Phase 2)', () => {
  it('수집부터 선정까지 한 번 돈다', async () => {
    const r = await runDailyDiscovery(db, claude);

    console.log(`\n수집 ${r.uniqueItems} → 필터통과 ${r.uniqueItems - Object.values(r.filtered).reduce((a, b) => a + b, 0)}`);
    console.log(`필터 탈락:`, r.filtered);
    console.log(`후보 ${r.candidates} → 토픽 ${r.topics} (폴백 ${r.groupingFellBack})`);
    console.log(`재채점 ${r.rescored}건`);
    console.log(`선정:`, r.selection);
    console.log(`발행 ${r.published}건, 고정비 $${r.costFixed}`);

    expect(r.failures).toEqual([]);
    expect(r.groupingFellBack, '폴백이면 그룹핑 호출이 실패한 것').toBe(false);
    expect(r.topics).toBeGreaterThan(50);

    // 재채점은 상위 N개로 고정된다 (D-19). 분포에 흔들리지 않는다
    expect(r.rescored).toBeLessThanOrEqual(thresholds.rescoreTopN);

    // 선정은 상한을 넘지 않는다
    expect(r.published).toBeLessThanOrEqual(thresholds.dailyCap);
    expect(r.selection.selected).toBe(r.published);
  }, 900_000);

  it('전 토픽의 판정이 run_topics 에 남는다 (2.7)', async () => {
    const { data: runs } = await db.from('pipeline_runs').select('id, topics_seen').limit(1).single();
    const { data: rows, count } = await db
      .from('run_topics')
      .select('*', { count: 'exact' })
      .eq('run_id', runs!.id);

    expect(count, '토픽 수와 기록 수가 같아야 한다').toBe(runs!.topics_seen);

    const scored = rows!.filter((r) => r.importance_score !== null);
    const selected = rows!.filter((r) => r.selected);
    const rescored = rows!.filter((r) => r.rescored);

    console.log(`\nrun_topics ${count}행 — 채점됨 ${scored.length}, 재채점 ${rescored.length}, 선정 ${selected.length}`);

    // 완료 기준: 전 토픽·점수·follow-up·통과 여부가 남는다
    expect(rows!.every((r) => r.topic_title.length > 0)).toBe(true);
    expect(rows!.every((r) => r.selected || r.reject_reason !== null), '탈락엔 사유가 있어야 한다').toBe(true);
    expect(selected.every((r) => r.reject_reason === null)).toBe(true);
    expect(rescored.every((r) => r.first_pass_score !== null), '재채점엔 1차 점수가 남아야 한다').toBe(true);
    expect(scored.every((r) => r.reason_novelty && r.reason_impact && r.reason_interest)).toBe(true);

    // 사유별 분포 — 캘리브레이션이 읽을 데이터
    const byReason: Record<string, number> = {};
    for (const r of rows!) {
      const key = r.reject_reason ?? 'selected';
      byReason[key] = (byReason[key] ?? 0) + 1;
    }
    console.log('판정 분포:', byReason);
  });

  it('두 번째 런은 후보가 0이다 (D-01)', async () => {
    const r = await runDailyDiscovery(db, claude);
    expect(r.skipped).toBeGreaterThan(50);
    expect(r.candidates).toBe(0);
    expect(r.topics).toBe(0);
    expect(r.published).toBe(0);
    // 토픽이 없으면 모델 호출도 없다 = 고정비 0
    expect(r.costFixed).toBe(0);
  }, 300_000);
});
