import { activeProfile, type PublishingProfile } from '@/config/profiles';
import { thresholds } from '@/config/thresholds';

import type { ScoredTopic } from './score-topics';

/**
 * 선정 규칙 (로드맵 2.6, D-61).
 *
 *   총점 >= threshold  그리고  모든 축 >= minAxis
 *
 * 두 조건이 다 필요하다. 총점만 보면 "거대하지만 지루한 발표"(impact 5, interest 1)와
 * "재미있지만 사소한 것"(interest 5, novelty 1)이 통과한다 (docs/RUBRIC.md).
 *
 * 표기는 항상 양성형으로 쓴다 — "어느 축도 2 이하가 아님" 같은 이중 부정은
 * 구현할 때 off-by-one 을 부른다 (D-09).
 *
 * ── 걷는 판정 (D-61) ──
 *
 * 임계를 넘은 토픽 중 무엇을 기사로 만들지는 **미리 계산한 목록이 아니라, 걸으면서
 * 정한다.** 조사는 정상적으로 실패할 수 있어서(D-21) 무엇이 만들어질지는 걸어봐야
 * 알기 때문이다.
 *
 * 예전 구조는 목록을 미리 만들고(`selectTopics`) 파이프라인이 순위대로 걸었다. 그런데
 * 그 목록에는 쿼터에 막힌 논문까지 순위가 붙어 있어서, 앞 순위가 조사에 실패하면
 * 파이프라인이 **막혔던 논문으로 그대로 내려갔다.** 09-14 런: 쿼터가 고른 것 3편,
 * 실제로 만들어진 것 5편. 쿼터는 첫 선발만 제약했고 결과물은 제약하지 못했다.
 *
 * 이제 매 시도 전에 "지금까지 **실제로** 만들어진 것" 을 보고 이 후보를 들일지 정한다
 * (`admit`). 파이프라인은 `nextCandidate` 로 걷고, 끝나면 `finalizeEntries` 로
 * 로그에 남길 사유를 확정한다 — 로그가 계획이 아니라 실제로 일어난 일을 말한다.
 */

export type RejectReason =
  /** 총점이 임계값 미만 */
  | 'below-total'
  /** 축 하나 이상이 하한 미만 */
  | 'below-axis'
  /** 통과했지만 하루 상한이 이미 찼음 */
  | 'over-cap'
  /** 통과했지만 그날 논문 쿼터가 이미 찼음 (D-57) */
  | 'paper-quota'
  /** 논문이라 미뤘다 — 아직 시도해볼 비논문이 남아 있었음 (1편 프로필, D-61) */
  | 'paper-deferred'
  /** 이미 만들어진 기사와 분야가 겹침 (2편 프로필, D-61) */
  | 'category-taken';

export interface SelectionEntry {
  score: ScoredTopic;
  /** 기사 생성을 **시도했는가.** 실패해도 시도한 것이다 — 로그의 시도 수가 사라지면 안 된다 */
  selected: boolean;
  reason: RejectReason | null;
  /** 통과한 것들 중 순위. 1부터. 탈락은 null */
  rank: number | null;
}

export interface SelectionResult {
  selected: ScoredTopic[];
  /** 전 토픽의 판정. 로그(2.7)에 그대로 넣는다 */
  entries: SelectionEntry[];
}

/**
 * 실제로 만들어진 기사.
 *
 * `category` 는 **작성 단계가 정한 실제 분야**다. 후보 쪽은 채점의 예측밖에 없지만
 * 이미 만든 쪽은 진짜 값이 있으므로 그걸로 비교한다
 */
export interface BuiltTopic {
  kind: ScoredTopic['kind'];
  category: string;
}

/** 세 축의 최솟값 */
export function minAxisScore(score: ScoredTopic): number {
  return Math.min(score.novelty.score, score.impact.score, score.interest.score);
}

/** 임계 규칙만 본다. 상한은 별개다 */
export function passesThreshold(score: ScoredTopic): boolean {
  return score.total >= thresholds.total && minAxisScore(score) >= thresholds.minAxis;
}

/** 임계를 통과한 토픽을 총점 내림차순으로. 동점이면 원래 순서를 유지해 결정적으로 만든다 */
export function rankPassing(scored: readonly ScoredTopic[]): ScoredTopic[] {
  const order = new Map(scored.map((s, i) => [s, i]));
  return scored
    .filter(passesThreshold)
    .sort((a, b) => b.total - a.total || (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * 이 후보를 **지금** 들여도 되는가. 안 되면 사유를 돌려준다.
 *
 * 판정 순서가 곧 로그에 남는 사유의 우선순위다:
 *   1. 논문 쿼터가 찼다        paper-quota
 *   2. 논문인데 비논문이 남았다  paper-deferred
 *   3. 분야가 겹친다           category-taken
 *   4. 상한이 찼다            over-cap
 *
 * **상한이 마지막인 이유**: `over-cap` 은 "모든 규칙을 통과했는데 자리가 없었다" 는 뜻이어야
 * 한다. 상한을 먼저 보면, 분야가 겹쳐 건너뛴 토픽도 걷기가 끝난 시점에는 상한이 차 있어
 * `over-cap` 으로 기록된다 — 로그가 "자리가 없었다" 고 거짓말을 한다. 걷기에는 차이가 없다
 * (어느 사유든 막히는 것은 같다).
 *
 * @param untried 아직 시도하지 않은 통과 토픽들 (후보 자신을 포함해도 된다)
 */
export function admit(
  candidate: ScoredTopic,
  built: readonly BuiltTopic[],
  profile: PublishingProfile,
  untried: readonly ScoredTopic[],
  /** 내부용 — 논문 보류 판정에서 "규칙상 들일 수 있는 비논문" 을 볼 때 상한을 빼고 본다 */
  ignoreCap = false,
): RejectReason | null {
  if (candidate.kind === 'paper') {
    if (profile.papers.mode === 'quota') {
      const papers = built.filter((b) => b.kind === 'paper').length;
      if (papers >= profile.papers.max) return 'paper-quota';
    } else {
      // 규칙상 들일 수 있는 비논문이 하나라도 남아 있으면 논문은 뒤로 미룬다.
      // **상한은 빼고 본다** — 비논문이 이미 자리를 채운 뒤에도 이 논문이 떨어진 이유는
      // "비논문을 우선했기 때문" 이지 "자리가 없어서" 가 아니다. 상한을 넣으면 걷기가
      // 끝난 시점에 사유가 over-cap 으로 바뀌어 로그가 틀린다 (ranking:sim 에서 보류 0 으로 나왔다).
      // 걷기에는 차이가 없다 — 자리가 차 있으면 어느 사유로든 막힌다.
      // 비논문에 대한 admit 은 이 분기로 들어오지 않으므로 재귀가 끝난다
      const nonPaperLeft = untried.some(
        (other) =>
          other.index !== candidate.index &&
          other.kind !== 'paper' &&
          admit(other, built, profile, untried, true) === null,
      );
      if (nonPaperLeft) return 'paper-deferred';
    }
  }

  if (profile.distinctCategories && built.some((b) => b.category === candidate.category)) {
    return 'category-taken';
  }

  if (!ignoreCap && built.length >= profile.dailyCap) return 'over-cap';

  return null;
}

/**
 * 아직 시도하지 않은 후보 중 지금 들일 수 있는 첫 번째. 없으면 null — 걷기가 끝난다.
 *
 * 상한을 따로 세지 않는다. `admit` 이 상한도 판정하므로 상한이 차면 null 이 된다.
 */
export function nextCandidate(
  ranked: readonly ScoredTopic[],
  tried: ReadonlySet<number>,
  built: readonly BuiltTopic[],
  profile: PublishingProfile,
): ScoredTopic | null {
  const untried = ranked.filter((s) => !tried.has(s.index));
  return untried.find((s) => admit(s, built, profile, untried) === null) ?? null;
}

/**
 * 걷기가 끝난 뒤 전 토픽의 판정을 확정한다 (로그용).
 *
 * 탈락한 토픽도 사유와 함께 돌려준다 — 로그만 보고 "왜 이 토픽이 떨어졌나"에
 * 답할 수 있어야 캘리브레이션이 가능하다 (로드맵 2.7, 2.8).
 */
export function finalizeEntries(
  scored: readonly ScoredTopic[],
  ranked: readonly ScoredTopic[],
  tried: ReadonlySet<number>,
  built: readonly BuiltTopic[],
  profile: PublishingProfile,
): SelectionEntry[] {
  const entries: SelectionEntry[] = [];

  for (const score of scored) {
    if (score.total < thresholds.total) {
      entries.push({ score, selected: false, reason: 'below-total', rank: null });
    } else if (minAxisScore(score) < thresholds.minAxis) {
      entries.push({ score, selected: false, reason: 'below-axis', rank: null });
    }
  }

  const untried = ranked.filter((s) => !tried.has(s.index));

  ranked.forEach((score, index) => {
    const rank = index + 1;

    if (tried.has(score.index)) {
      entries.push({ score, selected: true, reason: null, rank });
      return;
    }

    // 걷기는 들일 수 있는 후보가 없을 때 끝나므로 여기서는 사유가 항상 나온다.
    // 규칙 쪽 사유가 상한보다 먼저 나온다 (`admit` 의 순서). 호출자가 걷기를 도중에
    // 끊었을 때만 null 이고, 그건 상한과 같은 뜻이다
    const reason = admit(score, built, profile, untried) ?? 'over-cap';
    entries.push({ score, selected: false, reason, rank });
  });

  return entries;
}

/**
 * **미리보기용.** 모든 시도가 성공한다고 치고 걸은 결과다.
 *
 * 파이프라인은 이걸 쓰지 않는다 — 조사가 실패하면 결과가 달라지므로 실제 선정은
 * `nextCandidate` 로 걷는다. 여기는 `pnpm ranking:sim` 처럼 "이 피드로 이 프로필이
 * 무엇을 고르나" 를 비용 없이 보려는 곳과 테스트가 쓴다.
 */
export function selectTopics(
  scored: readonly ScoredTopic[],
  profile: PublishingProfile = activeProfile(),
): SelectionResult {
  const ranked = rankPassing(scored);
  const tried = new Set<number>();
  const built: BuiltTopic[] = [];

  for (
    let candidate = nextCandidate(ranked, tried, built, profile);
    candidate;
    candidate = nextCandidate(ranked, tried, built, profile)
  ) {
    tried.add(candidate.index);
    built.push({ kind: candidate.kind, category: candidate.category });
  }

  const entries = finalizeEntries(scored, ranked, tried, built, profile);
  const selected = entries
    .filter((e) => e.selected)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((e) => e.score);

  return { selected, entries };
}

/** 로그용 사유별 집계. `selected` 는 시도한 수다 */
export function summarizeSelection(entries: readonly SelectionEntry[]): {
  selected: number;
  passedThreshold: number;
  belowTotal: number;
  belowAxis: number;
  overCap: number;
  paperQuota: number;
  paperDeferred: number;
  categoryTaken: number;
} {
  const count = (reason: RejectReason) => entries.filter((e) => e.reason === reason).length;
  const overCap = count('over-cap');
  const paperQuota = count('paper-quota');
  const paperDeferred = count('paper-deferred');
  const categoryTaken = count('category-taken');
  const selected = entries.filter((e) => e.selected).length;

  return {
    selected,
    paperQuota,
    paperDeferred,
    categoryTaken,
    passedThreshold: selected + overCap + paperQuota + paperDeferred + categoryTaken,
    belowTotal: count('below-total'),
    belowAxis: count('below-axis'),
    overCap,
  };
}
