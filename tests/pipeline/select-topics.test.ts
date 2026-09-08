import { afterEach, describe, expect, it } from 'vitest';

import { thresholds } from '@/config/thresholds';
import {
  minAxisScore,
  passesThreshold,
  selectTopics,
  summarizeSelection,
} from '@/pipeline/score/select-topics';

import type { ScoredTopic } from '@/pipeline/score/score-topics';

/**
 * 기본 kind 는 `event` 다 — 논문 쿼터(D-57)와 무관하게 임계·상한 규칙만 보려는
 * 테스트들이 대부분이기 때문이다. 쿼터를 보는 테스트는 kind 를 명시한다.
 */
const s = (
  index: number,
  n: number,
  i: number,
  r: number,
  kind: ScoredTopic['kind'] = 'event',
): ScoredTopic => ({
  index,
  kind,
  novelty: { score: n, reason: 'n' },
  impact: { score: i, reason: 'i' },
  interest: { score: r, reason: 'r' },
  total: n + i + r,
});

const ENV_KEYS = [
  'TECHNOW_THRESHOLD_TOTAL',
  'TECHNOW_MIN_AXIS',
  'TECHNOW_DAILY_CAP',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('passesThreshold (D-09)', () => {
  it('총점과 축 하한을 둘 다 만족해야 통과', () => {
    expect(passesThreshold(s(0, 4, 3, 3))).toBe(true); // 10, 최소 3
  });

  it('총점 미달이면 탈락', () => {
    expect(passesThreshold(s(0, 3, 3, 3))).toBe(false); // 9
  });

  it('총점이 높아도 축 하나가 낮으면 탈락', () => {
    // "거대하지만 지루한 발표" — impact 5, interest 1
    expect(passesThreshold(s(0, 5, 5, 2))).toBe(false); // 12 이지만 축 2
  });

  it('축이 전부 하한이어도 총점이 모자라면 탈락', () => {
    // 3+3+3=9. 축 하한만으로 통과되면 총점 조건이 무의미해진다
    expect(passesThreshold(s(0, 3, 3, 3))).toBe(false);
  });

  it('만점은 통과', () => {
    expect(passesThreshold(s(0, 5, 5, 5))).toBe(true);
  });
});

describe('minAxisScore', () => {
  it('세 축의 최솟값', () => {
    expect(minAxisScore(s(0, 5, 2, 4))).toBe(2);
  });
});

describe('selectTopics', () => {
  it('총점 순으로 상한까지 고른다', () => {
    const scored = [s(0, 3, 3, 4), s(1, 5, 5, 5), s(2, 4, 4, 4), s(3, 5, 4, 4)];
    const { selected } = selectTopics(scored, 2);
    expect(selected.map((x) => x.total)).toEqual([15, 13]);
  });

  it('상한에 밀린 토픽은 over-cap 으로 남는다', () => {
    const scored = [s(0, 5, 5, 5), s(1, 4, 4, 4), s(2, 4, 3, 3)];
    const { entries } = selectTopics(scored, 1);
    const overCap = entries.filter((e) => e.reason === 'over-cap');
    expect(overCap).toHaveLength(2);
    // 순위는 남는다 — 캘리브레이션에서 "몇 등이었나"를 봐야 한다
    expect(overCap.map((e) => e.rank)).toEqual([2, 3]);
  });

  it('탈락 사유를 구분한다', () => {
    const scored = [
      s(0, 3, 3, 3), // 9 — 총점 미달
      s(1, 5, 5, 2), // 12 — 축 미달
      s(2, 5, 5, 5), // 15 — 통과
    ];
    const { entries } = selectTopics(scored, 3);
    const byIndex = new Map(entries.map((e) => [e.score.index, e.reason]));
    expect(byIndex.get(0)).toBe('below-total');
    expect(byIndex.get(1)).toBe('below-axis');
    expect(byIndex.get(2)).toBeNull();
  });

  it('전 토픽이 판정 결과에 나온다 (로그용)', () => {
    const scored = [s(0, 1, 1, 1), s(1, 5, 5, 5), s(2, 3, 3, 3)];
    const { entries } = selectTopics(scored, 1);
    expect(entries).toHaveLength(3);
  });

  it('동점이면 원래 순서를 유지한다 (결정적)', () => {
    const scored = [s(7, 4, 4, 4), s(8, 4, 4, 4)];
    const { selected } = selectTopics(scored, 1);
    expect(selected[0]!.index).toBe(7);
  });

  it('통과가 하나도 없으면 빈 결과', () => {
    // "No new stories today" 가 뜨는 경우
    const { selected } = selectTopics([s(0, 1, 1, 1), s(1, 2, 2, 2)], 3);
    expect(selected).toEqual([]);
  });
});

describe('config 를 배포 없이 바꿀 수 있다 (2.6)', () => {
  // 총점 15, 12, 10, 10, 12, 10, 11 — 넷째(3,4,3)까지 전부 임계 통과다.
  // 상한이 실제로 무는지 보려면 통과 건수가 상한보다 많아야 한다
  const scored = [
    s(0, 5, 5, 5),
    s(1, 4, 4, 4),
    s(2, 4, 3, 3),
    s(3, 3, 4, 3),
    s(4, 4, 4, 4),
    s(5, 3, 3, 4),
    s(6, 4, 4, 3),
  ];

  it('통과 건수가 상한보다 많으면 상한에서 잘린다', () => {
    expect(scored.length).toBeGreaterThan(thresholds.dailyCap);
    expect(selectTopics(scored).selected).toHaveLength(thresholds.dailyCap);
  });

  it('임계값을 올리면 선정 결과가 바뀐다', () => {
    process.env.TECHNOW_THRESHOLD_TOTAL = '13';
    // 15, 12, 10, 10, 12, 10, 11 중 13 이상은 하나
    expect(selectTopics(scored).selected).toHaveLength(1);
  });

  it('축 하한을 올리면 선정 결과가 바뀐다', () => {
    process.env.TECHNOW_MIN_AXIS = '4';
    // 축이 전부 4 이상인 건 (5,5,5) 와 (4,4,4) 둘 — 그리고 (4,4,4) 가 하나 더
    expect(selectTopics(scored).selected).toHaveLength(3);
  });

  it('상한을 바꾸면 선정 수가 바뀐다', () => {
    process.env.TECHNOW_DAILY_CAP = '1';
    expect(selectTopics(scored).selected).toHaveLength(1);
  });

  it('잘못된 값은 무시하고 기본값을 쓴다', () => {
    // 오타로 파이프라인이 멈추면 안 된다
    process.env.TECHNOW_THRESHOLD_TOTAL = '열';
    expect(thresholds.total).toBe(10);
  });

  it('빈 문자열도 기본값', () => {
    process.env.TECHNOW_DAILY_CAP = '';
    expect(thresholds.dailyCap).toBe(5);
  });
});

describe('summarizeSelection', () => {
  it('사유별로 집계한다', () => {
    const scored = [s(0, 1, 1, 1), s(1, 5, 5, 2), s(2, 5, 5, 5), s(3, 4, 4, 4)];
    const { entries } = selectTopics(scored, 1);
    expect(summarizeSelection(entries)).toEqual({
      selected: 1,
      passedThreshold: 2,
      belowTotal: 1,
      belowAxis: 1,
      overCap: 1,
      paperQuota: 0,
    });
  });
});

/**
 * 논문 쿼터 (D-57).
 *
 * 후보 풀의 66% 가 논문 보도자료 재게시처이고 임계 통과에서는 63% 로 더 쏠린다.
 * 사용자가 "사실상 논문을 그대로 요약해놓은 기사" 를 문제로 지목했다.
 * **점수를 주무르지 않고 카운터로 막는다** — 점수 조정은 두 번 다 실패했다.
 */
describe('논문 쿼터 (D-57)', () => {
  const paper = (index: number, n: number, i: number, r: number) => s(index, n, i, r, 'paper');

  it('상한 안에서 논문이 쿼터를 넘지 못한다', () => {
    // 전부 논문이고 전부 통과한다. 상한은 5, 쿼터는 2
    const scored = [0, 1, 2, 3, 4].map((k) => paper(k, 5, 5, 5));
    const { selected, entries } = selectTopics(scored, 5, 2);

    expect(selected).toHaveLength(2);
    expect(summarizeSelection(entries).paperQuota).toBe(3);
  });

  it('쿼터에 막힌 자리를 비논문이 채운다', () => {
    // 논문 3건이 점수가 더 높지만 2건만 들어가고, 나머지는 event 가 채운다
    const scored = [
      paper(0, 5, 5, 5),
      paper(1, 5, 5, 5),
      paper(2, 5, 5, 5),
      s(3, 4, 4, 4, 'event'),
      s(4, 4, 4, 3, 'trend'),
    ];
    const { selected } = selectTopics(scored, 5, 2);

    // 상한 5 를 다 채우되 논문은 둘뿐이다
    expect(selected).toHaveLength(4);
    expect(selected.filter((x) => x.kind === 'paper')).toHaveLength(2);
  });

  it('비논문이 마르면 상한에 못 미친다 — 의도된 손해다', () => {
    // 논문 5건뿐이면 2건만 나간다. 논문 5건보다 잘 섞인 2건이 낫다는 판단
    const scored = [0, 1, 2, 3, 4].map((k) => paper(k, 5, 5, 5));
    expect(selectTopics(scored, 5, 2).selected).toHaveLength(2);
  });

  it('논문이 아니면 쿼터와 무관하다', () => {
    const scored = [0, 1, 2, 3, 4].map((k) => s(k, 5, 5, 5, 'event'));
    expect(selectTopics(scored, 5, 2).selected).toHaveLength(5);
  });

  it('쿼터에 막힌 것도 임계는 통과한 것으로 센다', () => {
    // 캘리브레이션에서 "왜 안 뽑혔나" 에 답할 수 있어야 한다 —
    // 점수가 모자란 것과 쿼터에 막힌 것은 완전히 다른 사유다
    const scored = [0, 1, 2].map((k) => paper(k, 5, 5, 5));
    const summary = summarizeSelection(selectTopics(scored, 5, 2).entries);

    expect(summary.passedThreshold).toBe(3);
    expect(summary.belowTotal).toBe(0);
    expect(summary.paperQuota).toBe(1);
  });
});
