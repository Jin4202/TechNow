import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { feeds } from '@/config/feeds';
import { thresholds } from '@/config/thresholds';
import { applyCheapFilters } from '@/pipeline/discover/cheap-filters';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { groupTopics } from '@/pipeline/group/group-topics';
import { scoreTopics } from '@/pipeline/score/score-topics';

// 실제 피드 + 실제 Claude 호출.
// 실행: pnpm score:live
const client = getAnthropic();

describe('1차 채점 (2.4)', () => {
  it('실제 수집분 전량을 채점하고 분포를 본다', async () => {
    const { items } = await fetchFeeds(feeds);
    const { kept } = applyCheapFilters(dedupeItems(items));
    const { topics, usage: groupUsage } = await groupTopics(client, kept, []);

    const start = Date.now();
    const { scored, unscored, usage, failedChunks } = await scoreTopics(
      client,
      topics.map((t) => ({
        title: t.title,
        items: t.items.map((i) => ({ title: i.title, description: i.description })),
      })),
    );
    const seconds = ((Date.now() - start) / 1000).toFixed(1);

    const scoreCost = (usage.inputTokens / 1e6) * 1 + (usage.outputTokens / 1e6) * 5;
    const groupCost = (groupUsage.inputTokens / 1e6) * 1 + (groupUsage.outputTokens / 1e6) * 5;

    // 선정 규칙: 총점 >= 10 && 모든 축 >= 3 (D-09)
    const passing = scored.filter(
      (s) =>
        s.total >= thresholds.total &&
        Math.min(s.novelty.score, s.impact.score, s.interest.score) >= thresholds.minAxis,
    );

    const totals = scored.map((s) => s.total).sort((a, b) => a - b);
    const histogram: Record<number, number> = {};
    for (const t of totals) histogram[t] = (histogram[t] ?? 0) + 1;

    const axisAvg = (pick: (s: (typeof scored)[number]) => number) =>
      (scored.reduce((sum, s) => sum + pick(s), 0) / scored.length).toFixed(2);

    console.log(`\n토픽 ${topics.length}개 채점 (${seconds}초), 실패 청크 ${failedChunks.length}개`);
    console.log(`채점 안 된 토픽: ${unscored.length}개`);
    console.log(`입력 ${usage.inputTokens} / 출력 ${usage.outputTokens} 토큰`);
    console.log(`캐시 읽기 ${usage.cacheReadTokens} / 생성 ${usage.cacheCreationTokens} 토큰`);
    console.log(`채점 비용 $${scoreCost.toFixed(4)} + 그룹핑 $${groupCost.toFixed(4)} = 고정비 $${(scoreCost + groupCost).toFixed(4)}/일`);
    console.log(`월 고정비 추정: $${((scoreCost + groupCost) * 30).toFixed(2)}`);
    console.log(`\n총점 분포: ${JSON.stringify(histogram)}`);
    console.log(`중앙값 ${totals[Math.floor(totals.length / 2)]}, 최고 ${totals.at(-1)}`);
    console.log(`축 평균 — novelty ${axisAvg((s) => s.novelty.score)}, impact ${axisAvg((s) => s.impact.score)}, interest ${axisAvg((s) => s.interest.score)}`);
    console.log(`\n임계 통과: ${passing.length}개 (총점>=${thresholds.total} && 모든축>=${thresholds.minAxis})`);

    for (const s of passing.sort((a, b) => b.total - a.total).slice(0, 6)) {
      const t = topics[s.index]!;
      console.log(`\n  [${s.total}] ${t.title.slice(0, 70)}`);
      console.log(`     N${s.novelty.score} ${s.novelty.reason.slice(0, 76)}`);
      console.log(`     I${s.impact.score} ${s.impact.reason.slice(0, 76)}`);
      console.log(`     R${s.interest.score} ${s.interest.reason.slice(0, 76)}`);
    }

    expect(failedChunks).toEqual([]);
    expect(unscored, '채점 안 된 토픽이 있으면 안 된다').toEqual([]);
    expect(scored).toHaveLength(topics.length);
    for (const s of scored) {
      expect(s.novelty.score).toBeGreaterThanOrEqual(1);
      expect(s.novelty.score).toBeLessThanOrEqual(5);
      expect(s.novelty.reason.length, '근거가 비면 캘리브레이션에 쓸 수 없다').toBeGreaterThan(0);
    }
  }, 600_000);
});
