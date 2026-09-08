import { thresholds } from '@/config/thresholds';

import type { ScoredTopic } from './score-topics';

/**
 * 선정 규칙 (로드맵 2.6).
 *
 *   총점 >= threshold  그리고  모든 축 >= minAxis
 *
 * 두 조건이 다 필요하다. 총점만 보면 "거대하지만 지루한 발표"(impact 5, interest 1)와
 * "재미있지만 사소한 것"(interest 5, novelty 1)이 통과한다 (docs/RUBRIC.md).
 *
 * 표기는 항상 양성형으로 쓴다 — "어느 축도 2 이하가 아님" 같은 이중 부정은
 * 구현할 때 off-by-one 을 부른다 (D-09).
 */

export type RejectReason =
  /** 총점이 임계값 미만 */
  | 'below-total'
  /** 축 하나 이상이 하한 미만 */
  | 'below-axis'
  /** 통과했지만 하루 상한에 밀림 */
  | 'over-cap'
  /** 통과했지만 그날 논문 쿼터가 찼음 (D-57) */
  | 'paper-quota';

export interface SelectionEntry {
  score: ScoredTopic;
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

/** 세 축의 최솟값 */
export function minAxisScore(score: ScoredTopic): number {
  return Math.min(score.novelty.score, score.impact.score, score.interest.score);
}

/** 임계 규칙만 본다. 상한은 별개다 */
export function passesThreshold(score: ScoredTopic): boolean {
  return score.total >= thresholds.total && minAxisScore(score) >= thresholds.minAxis;
}

/**
 * 임계 규칙과 하루 상한을 적용한다.
 *
 * 탈락한 토픽도 사유와 함께 돌려준다 — 로그만 보고 "왜 이 토픽이 떨어졌나"에
 * 답할 수 있어야 캘리브레이션이 가능하다 (로드맵 2.7, 2.8).
 */
export function selectTopics(
  scored: readonly ScoredTopic[],
  cap: number = thresholds.dailyCap,
  maxPapers: number = thresholds.maxPapersPerDay,
): SelectionResult {
  const entries: SelectionEntry[] = [];
  const passing: ScoredTopic[] = [];

  for (const score of scored) {
    if (score.total < thresholds.total) {
      entries.push({ score, selected: false, reason: 'below-total', rank: null });
    } else if (minAxisScore(score) < thresholds.minAxis) {
      entries.push({ score, selected: false, reason: 'below-axis', rank: null });
    } else {
      passing.push(score);
    }
  }

  // 총점 내림차순. 동점이면 원래 순서를 유지해 결정적으로 만든다
  const order = new Map(scored.map((s, i) => [s, i]));
  const ranked = [...passing].sort(
    (a, b) => b.total - a.total || (order.get(a) ?? 0) - (order.get(b) ?? 0),
  );

  // 논문 쿼터 (D-57). **점수순으로 걸으면서 논문이 상한을 넘으면 건너뛴다.**
  // 건너뛴 자리는 다음 순위가 채우므로 상한까지는 채워진다 — 비논문이 마르면
  // 그때만 5건에 못 미친다
  const selected: ScoredTopic[] = [];
  let papers = 0;

  ranked.forEach((score, index) => {
    const rank = index + 1;

    if (selected.length >= cap) {
      entries.push({ score, selected: false, reason: 'over-cap', rank });
      return;
    }

    if (score.kind === 'paper' && papers >= maxPapers) {
      entries.push({ score, selected: false, reason: 'paper-quota', rank });
      return;
    }

    if (score.kind === 'paper') papers += 1;
    selected.push(score);
    entries.push({ score, selected: true, reason: null, rank });
  });

  return { selected, entries };
}

/** 로그용 사유별 집계 */
export function summarizeSelection(entries: readonly SelectionEntry[]): {
  selected: number;
  passedThreshold: number;
  belowTotal: number;
  belowAxis: number;
  overCap: number;
  paperQuota: number;
} {
  const count = (reason: RejectReason) => entries.filter((e) => e.reason === reason).length;
  const overCap = count('over-cap');
  const paperQuota = count('paper-quota');
  const selected = entries.filter((e) => e.selected).length;

  return {
    selected,
    paperQuota,
    passedThreshold: selected + overCap + paperQuota,
    belowTotal: count('below-total'),
    belowAxis: count('below-axis'),
    overCap,
  };
}
