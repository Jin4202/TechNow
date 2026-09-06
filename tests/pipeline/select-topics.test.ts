import { afterEach, describe, expect, it } from 'vitest';

import { thresholds } from '@/config/thresholds';
import {
  minAxisScore,
  passesThreshold,
  selectTopics,
  summarizeSelection,
} from '@/pipeline/score/select-topics';

import type { ScoredTopic } from '@/pipeline/score/score-topics';

const s = (index: number, n: number, i: number, r: number): ScoredTopic => ({
  index,
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
    });
  });
});
