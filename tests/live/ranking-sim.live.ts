import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { feeds } from '@/config/feeds';
import { thresholds } from '@/config/thresholds';
import { applyCheapFilters } from '@/pipeline/discover/cheap-filters';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { groupTopics } from '@/pipeline/group/group-topics';
import { scoreTopics } from '@/pipeline/score/score-topics';
import { minAxisScore, passesThreshold } from '@/pipeline/score/select-topics';

import type { ScoredTopic } from '@/pipeline/score/score-topics';

/**
 * 정렬 규칙 모의 (로드맵 8.3a). 실행: `pnpm ranking:sim`
 *
 * **사용자가 지적한 문제**: 기사가 너무 전문적이다. 대상 독자는 그 분야 바깥에
 * 있으면서 흐름은 따라가고 싶은 사람인데, 지금 목록이 그들에게 흥미롭지 않다.
 *
 * **이것은 루브릭이 아니라 정렬의 문제로 보인다.** `interest` 축은 이미 비전문
 * 독자를 겨냥한다 (`docs/RUBRIC.md` 축 3). 그런데 선정이 **총점 내림차순**이라:
 *
 *     novelty 5 / impact 4 / interest 3  → 총점 12  ← 뽑힌다 (전문적)
 *     novelty 3 / impact 3 / interest 5  → 총점 11  ← 밀린다 (읽기 좋다)
 *
 * 실측 축 평균도 novelty 3.04 / impact 2.34 / **interest 2.99** 로 하한에 붙어 있다.
 *
 * **여기서는 아무것도 바꾸지 않는다.** 같은 점수에 정렬 규칙만 달리 적용해
 * 상위 5건이 어떻게 달라지는지 **제목으로** 보여준다. 어느 목록이 읽고 싶은지는
 * 점수가 아니라 사람이 제목을 보고 정할 일이다.
 *
 * 비용: 채점까지만 돈다 (그룹핑·채점 모두 Haiku). 기사를 만들지 않으므로
 * 한 번에 고정비 수준($0.1 안팎)이고, 재채점·조사·작성은 건너뛴다.
 */

interface Rule {
  name: string;
  why: string;
  /** 통과 판정. 기본은 현행 규칙 */
  passes?: (s: ScoredTopic) => boolean;
  /** 정렬. 내림차순 기준값 */
  key: (s: ScoredTopic) => number;
}

const RULES: Rule[] = [
  {
    name: '현행 — 총점 내림차순',
    why: '총점 ≥ 10 && 모든 축 ≥ 3, 총점순',
    key: (s) => s.total,
  },
  {
    name: 'interest 하한 4',
    why: '축별 비대칭 하한. 흥미가 4 미만이면 아무리 중요해도 안 뽑는다',
    passes: (s) =>
      s.total >= thresholds.total &&
      minAxisScore(s) >= thresholds.minAxis &&
      s.interest.score >= 4,
    key: (s) => s.total,
  },
  {
    name: 'interest 우선 정렬',
    why: '통과 규칙은 그대로. 흥미순으로 뽑고 동점이면 총점',
    key: (s) => s.interest.score * 100 + s.total,
  },
  {
    name: '가중 총점 (interest × 2)',
    why: '흥미에 두 배 무게. 중요하면서 재미있는 쪽이 이긴다',
    key: (s) => s.novelty.score + s.impact.score + s.interest.score * 2,
  },
];

describe('정렬 규칙 모의 (8.3a)', () => {
  it('같은 점수에 규칙만 달리 적용해 상위 5건을 비교한다', async () => {
    const claude = getAnthropic();

    const { items } = await fetchFeeds(feeds);
    const kept = applyCheapFilters(dedupeItems(items)).kept;
    // 최근 발행 기사는 넘기지 않는다 — 후속 판정은 이 모의의 관심사가 아니다
    const grouped = await groupTopics(claude, kept, []);
    const scored = await scoreTopics(
      claude,
      grouped.topics.map((t) => ({
        title: t.title,
        items: t.items.map((i) => ({ title: i.title, description: i.description })),
      })),
    );

    const all = scored.scored;
    console.log(`\n수집 ${items.length} → 필터통과 ${kept.length} → 토픽 ${grouped.topics.length} → 채점 ${all.length}`);

    const avg = (pick: (s: ScoredTopic) => number) =>
      (all.reduce((sum, s) => sum + pick(s), 0) / Math.max(all.length, 1)).toFixed(2);
    console.log(
      `축 평균  novelty ${avg((s) => s.novelty.score)}  impact ${avg((s) => s.impact.score)}  interest ${avg((s) => s.interest.score)}`,
    );

    const titleOf = (s: ScoredTopic) => grouped.topics[s.index]?.title ?? '(제목 없음)';

    for (const rule of RULES) {
      const passing = all.filter(rule.passes ?? passesThreshold);
      const top = [...passing]
        .sort((a, b) => rule.key(b) - rule.key(a))
        .slice(0, thresholds.dailyCap);

      console.log(`\n━━ ${rule.name}  (통과 ${passing.length}건)`);
      console.log(`   ${rule.why}`);
      for (const s of top) {
        console.log(
          `   n${s.novelty.score} i${s.impact.score} r${s.interest.score} = ${String(s.total).padStart(2)}  ${titleOf(s).slice(0, 74)}`,
        );
      }
    }

    // 규칙끼리 겹치는 정도. 전부 같으면 정렬을 바꿔도 소용이 없다는 뜻이다
    const topSet = (rule: Rule) =>
      new Set(
        [...all.filter(rule.passes ?? passesThreshold)]
          .sort((a, b) => rule.key(b) - rule.key(a))
          .slice(0, thresholds.dailyCap)
          .map((s) => s.index),
      );
    const current = topSet(RULES[0]!);
    console.log('\n현행과 겹치는 건수:');
    for (const rule of RULES.slice(1)) {
      const overlap = [...topSet(rule)].filter((i) => current.has(i)).length;
      console.log(`  ${overlap}/${current.size}  ${rule.name}`);
    }

    expect(all.length).toBeGreaterThan(0);
  }, 900_000);
});
