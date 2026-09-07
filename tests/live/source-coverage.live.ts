import { describe, expect, it } from 'vitest';

import { BraveClient } from '@/clients/brave';
import { createFetchContext, fetchPage } from '@/pipeline/research/fetch-page';
import { classifySource, normalizeHost } from '@/pipeline/research/source-tier';

/**
 * tier 허용목록의 커버리지를 잰다. 실행: `pnpm sources:coverage`
 *
 * `src/config/source-tiers.ts` 헤더가 지시하는 절차다 —
 * "추측으로 늘리지 말고 **실제로 걸러진 도메인을 보고** 근거와 함께 추가한다."
 *
 * tier 판정은 허용목록이라 목록에 없는 도메인은 전부 `unknown` 으로 버려진다.
 * 그래서 조사가 최소 출처 3건을 못 채우는 일이 생긴다 — 2026-09-06 런에서
 * 실패 6건 중 4건이 `too-few-sources` 였다.
 *
 * **LLM 을 부르지 않는다.** 토픽 제목을 그대로 검색어로 쓴다. 쿼리 생성 단계의
 * 품질이 아니라 **허용목록의 커버리지**를 재는 것이 목적이고, Brave 는 무료 티어다.
 */

/** 2026-09-06 로컬 종단 런에서 too-few-sources 로 실패한 토픽들 */
const FAILED_TOPICS = [
  'Nancy Grace Roman Space Telescope begins three-month journey to L2',
  'US study tests psilocybin to reduce painful side effects of chemotherapy',
  "Alzheimer's brain changes may appear seven years before symptoms",
  'Scientists find vast hidden magma system deep beneath Mars',
];

describe('출처 허용목록 커버리지', () => {
  it('실패한 토픽에서 무엇이 걸러지는지 본다', async () => {
    const brave = new BraveClient();
    const unknownHosts = new Map<string, number>();
    const blockedHosts = new Map<string, number>();
    let total = 0;
    let accepted = 0;

    for (const topic of FAILED_TOPICS) {
      const results = await brave.search(topic, 20);
      const rows: string[] = [];
      let kept = 0;

      for (const result of results) {
        total += 1;
        const verdict = classifySource(result.url);
        const host = normalizeHost(result.url) ?? '?';

        if (verdict.tier) {
          kept += 1;
          accepted += 1;
          rows.push(`  T${verdict.tier}  ${host}`);
          continue;
        }
        const bucket = verdict.reason === 'blocked' ? blockedHosts : unknownHosts;
        bucket.set(host, (bucket.get(host) ?? 0) + 1);
        rows.push(`  ${verdict.reason === 'blocked' ? '차단' : '미상'}  ${host}`);
      }

      console.log(`\n━━ ${topic.slice(0, 62)}`);
      console.log(`   결과 ${results.length}건 → 통과 ${kept}건 (최소 3건 필요)`);
      for (const row of rows) console.log(row);
    }

    const rank = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]);

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`검색 결과 ${total}건 중 통과 ${accepted}건 (${Math.round((accepted / total) * 100)}%)`);

    console.log(`\n미상으로 버려진 호스트 ${unknownHosts.size}종 — 여기서 목록을 넓힌다:`);
    for (const [host, n] of rank(unknownHosts)) console.log(`  ${String(n).padStart(2)}회  ${host}`);

    console.log(`\n차단 목록에 걸린 호스트 (의도된 것):`);
    for (const [host, n] of rank(blockedHosts)) console.log(`  ${String(n).padStart(2)}회  ${host}`);

    expect(total).toBeGreaterThan(0);
  }, 300_000);

  /**
   * tier 를 통과한 뒤 **본문 추출에서** 얼마나 더 잃는지 본다.
   *
   * 첫 검사에서 tier 통과는 4건 모두 3건 이상이었다 (8·4·5·3). 그런데 실제 런에서는
   * 1~2건으로 실패했다 — 손실이 tier 가 아니라 fetch·추출 단계에서 난다는 뜻이다.
   * **LLM 없음, HTTP 만.**
   */
  it('통과한 후보가 본문 추출에서 얼마나 더 죽는지 본다', async () => {
    const brave = new BraveClient();
    const context = createFetchContext();
    const reasons = new Map<string, number>();
    let candidates = 0;
    let usable = 0;

    for (const topic of FAILED_TOPICS) {
      const results = await brave.search(topic, 20);
      const passed = results.filter((r) => classifySource(r.url).tier !== null);
      const rows: string[] = [];
      let ok = 0;

      for (const result of passed) {
        candidates += 1;
        const page = await fetchPage(context, result.url);
        const host = normalizeHost(result.url) ?? '?';

        if (page.ok) {
          ok += 1;
          usable += 1;
          rows.push(`  ✓ ${String(page.text.length).padStart(6)}자  ${host}`);
        } else {
          reasons.set(page.reason, (reasons.get(page.reason) ?? 0) + 1);
          rows.push(`  ✗ ${page.reason.padEnd(13)} ${host}`);
        }
      }

      console.log(`\n━━ ${topic.slice(0, 58)}`);
      console.log(`   tier 통과 ${passed.length} → 본문 확보 ${ok} (최소 3건 필요)`);
      for (const row of rows) console.log(row);
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`tier 통과 ${candidates}건 → 본문 확보 ${usable}건 (${Math.round((usable / candidates) * 100)}%)`);
    console.log('\n실패 사유:');
    for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(2)}회  ${reason}`);
    }

    expect(candidates).toBeGreaterThan(0);
  }, 600_000);
});
