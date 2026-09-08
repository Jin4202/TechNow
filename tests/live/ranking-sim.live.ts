import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { feeds } from '@/config/feeds';
import { thresholds } from '@/config/thresholds';
import { applyCheapFilters } from '@/pipeline/discover/cheap-filters';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { groupTopics } from '@/pipeline/group/group-topics';
import { scoreTopics } from '@/pipeline/score/score-topics';
import { passesThreshold, selectTopics } from '@/pipeline/score/select-topics';
import { SCORING_SYSTEM } from '@/prompts/score-topics';

import type { ScoredTopic } from '@/pipeline/score/score-topics';

/**
 * 채점 기준 비교 (로드맵 8.3). 실행: `pnpm ranking:sim`
 *
 * **사용자가 지적한 문제**: 기사가 너무 전문적이다. 대상 독자는 그 분야 바깥에
 * 있으면서 흐름은 따라가고 싶은 사람인데, 지금 목록이 그들에게 흥미롭지 않다.
 *
 * 처음에는 **정렬 문제**로 봤다 — 선정이 총점 내림차순이라 학술적 중요도가
 * 흥미를 이긴다는 가설이었다. **모의로 확인하니 틀렸다** (D-56):
 * 정렬 규칙을 어떻게 바꿔도 상위 5건이 거의 그대로였다. 지금도 뽑히는 것들이
 * 이미 interest 4~5 를 받기 때문이다.
 *
 * **그래서 채점 자체를 본다.** 같은 토픽을 두 기준으로 채점해 눈금이 어디로
 * 옮겨가는지 비교한다. 판단은 사람이 제목을 보고 한다 — 점수가 아니라.
 *
 * 비용: 그룹핑 1회 + 채점 2회, 전부 Haiku 다. 기사를 만들지 않으므로
 * 한 번에 $0.2 안팎이고 조사·작성·검증은 건너뛴다.
 */

/**
 * 후보 채점 기준 — `interest` 축만 바꾼다.
 *
 * 지금 프롬프트의 축 3 은 **구체 예시가 하나도 없다.** 추상 등급만 있어서
 * ("Immediately compelling without explanation") 모델이 눈금을 스스로 만든다.
 * "8글자 합성 DNA" 가 극적으로 들리면 5 를 줄 만하다.
 *
 * 바꾸는 것 셋:
 *   1. **앵커에 실제 제목 예시를 넣는다.** 그것도 일상에 닿는 것으로
 *   2. **"휴대폰 화면에 도착한 제목"** 이라는 구체적 판정 기준을 준다
 *   3. **중요도와 흥미를 명시적으로 분리한다.** 지금 채점기가 둘을 섞고 있는 것이
 *      D-56 이 찾은 원인이다 — 중요한 연구에 흥미 5 를 준다
 */
const CANDIDATE_SYSTEM = SCORING_SYSTEM.replace(
  `READER INTEREST — will a curious non-specialist click and finish it?
5  Immediately compelling without explanation.
4  Interesting once you read one sentence of context.
3  Needs background, but is interesting once explained.
2  Interesting only to specialists.
1  No reason for a general reader to read it.

This measures "worth finishing", not "drives clicks". A trivial result dressed in dramatic language scores low.`,
  `READER INTEREST — will someone outside this field want to read it?

Your reader follows science and technology the way people follow a sport they do not play. They are not researchers. They read to know what is changing in the world, to understand things they keep hearing about, and to have something worth repeating to a friend.

5  They would send it to someone. It touches something already in their life — health, money, work, the phone in their pocket, the weather, the food they eat — or it is simply astonishing on sight.
   "A common sugar substitute turns into a substance that damages the liver"
   "Telescope launched today will map how the universe is pulling itself apart"
4  They would read it because it is a subject they already wonder about, even if the finding itself is technical.
   "An AI system now steers fusion plasma faster than any human operator"
3  Interesting once explained, but the title alone means nothing to them.
   "Protein structure prediction gains a way to model shape changes"
2  You would have to work in the field to care.
   "A method reduces the complexity of a specific matrix operation"
1  Nothing here for anyone outside the lab.

Judge the title as it would arrive on a phone screen, with no context and no explanation. If knowing why it matters requires already knowing what a technical term means, that is 3 at best — however important the work is.

**Importance is not interest.** A result can reshape a field and still score 2 here. Impact already carries the importance; do not pay for it twice. This measures "worth finishing", not "drives clicks" — a trivial result dressed in dramatic language scores low.`,
);

describe('채점 기준 비교 (8.3)', () => {
  it('같은 토픽을 두 기준으로 채점해 상위 5건을 비교한다', async () => {
    const claude = getAnthropic();

    const { items } = await fetchFeeds(feeds);
    const kept = applyCheapFilters(dedupeItems(items)).kept;
    const grouped = await groupTopics(claude, kept, []);
    const input = grouped.topics.map((t) => ({
      title: t.title,
      items: t.items.map((i) => ({ title: i.title, description: i.description })),
    }));

    console.log(`\n수집 ${items.length} → 필터통과 ${kept.length} → 토픽 ${grouped.topics.length}`);
    expect(CANDIDATE_SYSTEM, '치환이 안 됐다 — 원문이 바뀌었는지 확인하라').not.toBe(SCORING_SYSTEM);

    // **같은 입력으로 두 번 채점한다.** 토픽이 다르면 비교가 성립하지 않는다
    // 피드 구성. **후보 풀이 무엇으로 채워져 있는지가 결과를 정한다** —
    // phys.org 와 ScienceDaily 는 개별 논문 보도자료를 재게시하는 곳이고
    // (그래서 출처로는 차단한다), 그 둘이 입력의 절반을 넘는다
    const countByFeed = (list: readonly { feedName: string }[]) => {
      const m = new Map<string, number>();
      for (const i of list) m.set(i.feedName, (m.get(i.feedName) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    console.log('\n입력 구성 (필터 통과분):');
    for (const [feed, n] of countByFeed(kept)) {
      console.log(`  ${String(n).padStart(3)}건 ${((n / kept.length) * 100).toFixed(0).padStart(3)}%  ${feed}`);
    }

    const current = await scoreTopics(claude, input);
    const candidate = process.env.SIM_CANDIDATE === '1'
      ? await scoreTopics(claude, input, CANDIDATE_SYSTEM)
      : null;
    const runs = [
      { name: '현행', result: current },
      ...(candidate ? [{ name: '후보', result: candidate }] : []),
    ].map((r) => ({ name: r.name, scored: r.result.scored, result: r.result }));

    /** 토픽이 어느 피드에서 왔나. 여러 피드가 섞였으면 첫 항목 기준 */
    const feedOf = (index: number) => grouped.topics[index]?.items[0]?.feedName ?? '?';

    // **채점 건수가 다르면 비교가 성립하지 않는다.** 실제로 후보에서 19건이
    // 조용히 빠진 적이 있다 (2026-09-07). 청크 실패를 눈에 보이게 한다
    for (const r of runs) {
      if (r.result.failedChunks.length > 0 || r.scored.length !== input.length) {
        console.log(
          `⚠️ ${r.name}: 입력 ${input.length} → 채점 ${r.scored.length}, ` +
            `실패 청크 ${r.result.failedChunks.length} · 미채점 ${r.result.unscored.length}`,
        );
      }
    }

    const titleOf = (index: number) => grouped.topics[index]?.title ?? '(제목 없음)';

    for (const run of runs) {
      const all = run.scored;
      const avg = (pick: (s: ScoredTopic) => number) =>
        (all.reduce((sum, s) => sum + pick(s), 0) / Math.max(all.length, 1)).toFixed(2);
      const passing = all.filter(passesThreshold);
      const top = [...passing].sort((a, b) => b.total - a.total).slice(0, thresholds.dailyCap);

      console.log(`\n━━ ${run.name}  채점 ${all.length}건 · 임계통과 ${passing.length}건`);
      console.log(
        `   축 평균  novelty ${avg((s) => s.novelty.score)}  impact ${avg((s) => s.impact.score)}  interest ${avg((s) => s.interest.score)}`,
      );
      // interest 분포. 눈금이 어디로 옮겨갔는지가 이 실험의 핵심이다
      const dist = [1, 2, 3, 4, 5].map(
        (n) => `${n}점 ${all.filter((s) => s.interest.score === n).length}`,
      );
      console.log(`   interest 분포  ${dist.join(' · ')}`);
      // **쿼터를 정하기 전에 분포를 본다** (D-57). 숫자를 추측으로 정하면
      // D-51 의 오탐을 반복한다
      const kinds = ['paper', 'event', 'product', 'trend'] as const;
      const kindLine = (list: readonly ScoredTopic[]) =>
        kinds
          .map((k) => `${k} ${list.filter((s) => s.kind === k).length}`)
          .join(' · ');
      console.log(`   종류 (채점 전체)  ${kindLine(all)}`);
      console.log(`   종류 (임계 통과)  ${kindLine(passing)}`);
      console.log(`   종류 (상위 ${thresholds.dailyCap})    ${kindLine(top)}`);
      // **쿼터가 실제로 어떻게 무는지.** 상한만 적용한 것과 비교한다
      const { selected: withQuota, entries } = selectTopics(all, thresholds.dailyCap);
      const { selected: noQuota } = selectTopics(all, thresholds.dailyCap, 99);
      const blocked = entries.filter((e) => e.reason === 'paper-quota').length;
      console.log(
        `   쿼터 적용  상한만 ${noQuota.length}건(논문 ${noQuota.filter((x) => x.kind === 'paper').length}) → ` +
          `쿼터 ${withQuota.length}건(논문 ${withQuota.filter((x) => x.kind === 'paper').length}) · 막힌 것 ${blocked}`,
      );
      console.log('   ── 쿼터 적용 후 발행될 목록 ──');
      for (const x of withQuota) {
        console.log(`   ${x.kind.padEnd(7)} n${x.novelty.score} i${x.impact.score} r${x.interest.score}  ${titleOf(x.index).slice(0, 62)}`);
      }
      console.log('   임계 통과분의 피드 구성:');
      for (const [feed, n] of countByFeed(passing.map((s) => ({ feedName: feedOf(s.index) })))) {
        console.log(`     ${String(n).padStart(3)}건 ${((n / passing.length) * 100).toFixed(0).padStart(3)}%  ${feed}`);
      }
      for (const s of top) {
        console.log(
          `   n${s.novelty.score} i${s.impact.score} r${s.interest.score} = ${String(s.total).padStart(2)}  [${feedOf(s.index)}] ${titleOf(s.index).slice(0, 58)}`,
        );
      }
    }

    // 후보를 안 돌렸으면 비교할 것이 없다 (SIM_CANDIDATE=1 로 켠다)
    if (runs.length > 1) {
      const topIndexes = (scored: ScoredTopic[]) =>
        new Set(
          [...scored.filter(passesThreshold)]
            .sort((a, b) => b.total - a.total)
            .slice(0, thresholds.dailyCap)
            .map((s) => s.index),
        );
      const before = topIndexes(runs[0]!.scored);
      const after = topIndexes(runs[1]!.scored);
      const overlap = [...after].filter((i) => before.has(i)).length;

      console.log(`\n상위 ${before.size}건 중 ${overlap}건이 그대로다`);
      if (overlap < before.size) {
        console.log('\n후보에서 새로 들어온 것:');
        for (const i of [...after].filter((x) => !before.has(x))) console.log(`  + ${titleOf(i).slice(0, 72)}`);
        console.log('후보에서 빠진 것:');
        for (const i of [...before].filter((x) => !after.has(x))) console.log(`  - ${titleOf(i).slice(0, 72)}`);
      }
    }

    expect(runs[0]!.scored.length).toBeGreaterThan(0);
  }, 1_200_000);
});
