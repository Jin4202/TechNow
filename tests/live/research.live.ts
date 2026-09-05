import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { BraveClient } from '@/clients/brave';
import { budget } from '@/config/budget';
import { createFetchContext } from '@/pipeline/research/fetch-page';
import { researchTopic } from '@/pipeline/research/research-topic';

// 실제 Claude + Brave + 웹 fetch. 실행: pnpm research:live
const claude = getAnthropic();

// 최근 실제 채점에서 상위에 오른 토픽들
const TOPICS = [
  {
    title: 'Nancy Grace Roman Space Telescope reaches L2 observation point',
    items: [
      {
        title: 'Roman Space Telescope begins three-month journey to L2',
        description:
          "NASA's Nancy Grace Roman Space Telescope is on its way to the Sun-Earth L2 Lagrange point, where it will survey the sky to study dark energy and exoplanets.",
      },
    ],
  },
  {
    title: 'Second complete map of a fruit fly brain completed',
    items: [
      {
        title: 'Second complete map of a fruit fly brain completed',
        description:
          'Researchers published a complete connectome of a male Drosophila brain, following the earlier female connectome.',
      },
    ],
  },
  {
    title: 'AD109 sleep apnea pill cuts breathing events by 44 percent',
    items: [
      {
        title: 'Sleep apnea pill reduces breathing events in phase 3 trial',
        description:
          'A combination drug strengthening upper airway muscles reduced apnea-hypopnea index by 44 percent in a phase 3 trial.',
      },
    ],
  },
];

describe('조사 태스크 (3.5)', () => {
  it('실제 토픽에서 출처를 모은다', async () => {
    const brave = new BraveClient();
    const fetchContext = createFetchContext();
    const outcomes = [];

    for (const topic of TOPICS) {
      const started = Date.now();
      const r = await researchTopic(claude, brave, fetchContext, topic);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);

      console.log(`\n━━ ${topic.title.slice(0, 66)}`);
      console.log(`   쿼리: ${r.queries.map((q) => `"${q}"`).join(', ')}`);
      console.log(`   검색 ${r.searchCalls}회, fetch ${r.pagesFetched}회, ${seconds}초`);
      console.log(`   출처 ${r.sources.length}건${r.skipped ? ` — SKIP: ${r.skipped}` : ''}`);
      for (const s of r.sources) {
        console.log(`     T${s.tier} ${String(s.text.length).padStart(6)}자  ${s.url.slice(0, 68)}`);
      }
      const byReason: Record<string, number> = {};
      for (const x of r.rejections) byReason[x.reason] = (byReason[x.reason] ?? 0) + 1;
      if (Object.keys(byReason).length) console.log(`   제외:`, byReason);

      outcomes.push(r);
    }

    const succeeded = outcomes.filter((r) => r.skipped === null);
    console.log(`\n성공 ${succeeded.length}/${outcomes.length}`);

    for (const r of outcomes) {
      // 상한이 지켜진다 (CLAUDE.md §2.6)
      expect(r.searchCalls).toBeLessThanOrEqual(budget.searchCallsPerTopic);
      expect(r.pagesFetched).toBeLessThanOrEqual(budget.pagesPerTopic);
      expect(r.sources.length).toBeLessThanOrEqual(budget.maxSources);
    }

    // 3.5 완료 기준: 한 토픽이 3~5개 출처를 만든다
    expect(succeeded.length, '어느 토픽도 최소 출처 수를 못 채우면 조사 단계가 성립하지 않는다').toBeGreaterThan(0);

    for (const r of succeeded) {
      expect(r.sources.length).toBeGreaterThanOrEqual(budget.minSources);
      // Tier 1 이 하나는 있어야 한다 (3.10)
      expect(r.sources.some((s) => s.tier === 1), 'Tier 1 출처가 없다').toBe(true);
    }
  }, 600_000);
});
