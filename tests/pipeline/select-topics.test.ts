import { afterEach, describe, expect, it } from 'vitest';

import { CATEGORY_VALUES } from '@/config/categories';
import { PROFILES, type PublishingProfile } from '@/config/profiles';
import { thresholds } from '@/config/thresholds';
import {
  finalizeEntries,
  minAxisScore,
  nextCandidate,
  passesThreshold,
  rankPassing,
  selectTopics,
  summarizeSelection,
  type BuiltTopic,
} from '@/pipeline/score/select-topics';

import type { ScoredTopic } from '@/pipeline/score/score-topics';

/**
 * 기본 kind 는 `event`, 기본 분야는 **인덱스마다 다르다** — 임계·상한 규칙만 보려는
 * 테스트가 논문 규칙이나 분야 규칙에 걸리지 않게 하기 위해서다. 규칙을 보는 테스트는
 * kind 와 분야를 명시한다.
 */
const s = (
  index: number,
  n: number,
  i: number,
  r: number,
  kind: ScoredTopic['kind'] = 'event',
  category: ScoredTopic['category'] = CATEGORY_VALUES[index % CATEGORY_VALUES.length]!,
): ScoredTopic => ({
  index,
  kind,
  category,
  novelty: { score: n, reason: 'n' },
  impact: { score: i, reason: 'i' },
  interest: { score: r, reason: 'r' },
  total: n + i + r,
});

/**
 * 총점을 **모든 축이 하한(3) 이상**이 되게 나눈다. 규칙 테스트는 임계를 확실히 통과한
 * 토픽으로만 해야 한다 — 축 하나가 2 로 떨어지면 걷기에 아예 안 들어와서, 테스트가
 * 규칙이 아니라 임계를 보게 된다 (처음에 `5, 5, total - 10` 으로 만들었다가 그렇게 샜다)
 */
const AXES: Record<Total, [number, number, number]> = {
  15: [5, 5, 5],
  14: [5, 5, 4],
  13: [5, 4, 4],
  12: [4, 4, 4],
  11: [4, 4, 3],
  10: [4, 3, 3],
};
type Total = 15 | 14 | 13 | 12 | 11 | 10;

const paper = (index: number, total: Total, category?: ScoredTopic['category']) =>
  s(index, ...AXES[total], 'paper', category);
const event = (index: number, total: Total, category?: ScoredTopic['category']) =>
  s(index, ...AXES[total], 'event', category);

/** 규칙 없이 상한만 무는 프로필. 임계·순위만 보는 테스트용 */
const capOnly = (dailyCap: number): PublishingProfile => ({
  ...PROFILES.two,
  dailyCap,
  papers: { mode: 'quota', max: dailyCap },
  distinctCategories: false,
});

/**
 * 파이프라인의 걷기를 그대로 흉내 낸다 (`run-daily.ts` 의 루프와 같은 모양).
 *
 * `outcome` 이 null 을 돌려주면 조사 실패, 분야 문자열을 돌려주면 **그 분야로**
 * 기사가 만들어진 것이다 — 작성이 채점의 예측과 다른 분야를 정하는 경우를 흉내 낼 수 있다.
 */
function walk(
  scored: readonly ScoredTopic[],
  profile: PublishingProfile,
  outcome: (topic: ScoredTopic) => string | null = (topic) => topic.category,
) {
  const ranked = rankPassing(scored);
  const tried = new Set<number>();
  const built: BuiltTopic[] = [];
  const attempts: number[] = [];

  for (
    let candidate = nextCandidate(ranked, tried, built, profile);
    candidate;
    candidate = nextCandidate(ranked, tried, built, profile)
  ) {
    tried.add(candidate.index);
    attempts.push(candidate.index);
    const category = outcome(candidate);
    if (category !== null) built.push({ kind: candidate.kind, category });
  }

  const entries = finalizeEntries(scored, ranked, tried, built, profile);
  const reasonOf = (index: number) => entries.find((e) => e.score.index === index)?.reason;
  return { attempts, built, entries, reasonOf };
}

const ENV_KEYS = ['TECHNOW_THRESHOLD_TOTAL', 'TECHNOW_MIN_AXIS', 'TECHNOW_PROFILE'] as const;

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
    expect(passesThreshold(s(0, 5, 5, 2))).toBe(false); // 12, 최소 2
  });

  it('축이 전부 하한이어도 총점이 모자라면 탈락', () => {
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

describe('selectTopics — 미리보기 (모든 시도가 성공한다고 칠 때)', () => {
  it('총점 순으로 상한까지 고른다', () => {
    const scored = [s(0, 3, 3, 4), s(1, 5, 5, 5), s(2, 4, 4, 4)];
    expect(selectTopics(scored, capOnly(2)).selected.map((x) => x.index)).toEqual([1, 2]);
  });

  it('상한에 밀린 토픽은 over-cap 으로 남는다', () => {
    const scored = [s(0, 5, 5, 5), s(1, 4, 4, 4)];
    const { entries } = selectTopics(scored, capOnly(1));
    expect(entries.find((e) => e.score.index === 1)?.reason).toBe('over-cap');
  });

  it('탈락 사유를 구분한다', () => {
    const scored = [s(0, 3, 3, 3), s(1, 5, 5, 2), s(2, 5, 5, 5)];
    const { entries } = selectTopics(scored, capOnly(3));
    const reasons = new Map(entries.map((e) => [e.score.index, e.reason]));
    expect(reasons.get(0)).toBe('below-total');
    expect(reasons.get(1)).toBe('below-axis');
    expect(reasons.get(2)).toBeNull();
  });

  it('전 토픽이 판정 결과에 나온다 (로그용)', () => {
    const scored = [s(0, 1, 1, 1), s(1, 5, 5, 5), s(2, 4, 4, 4)];
    expect(selectTopics(scored, capOnly(1)).entries).toHaveLength(3);
  });

  it('동점이면 원래 순서를 유지한다 (결정적)', () => {
    const scored = [s(0, 4, 4, 4), s(1, 4, 4, 4), s(2, 4, 4, 4)];
    expect(selectTopics(scored, capOnly(1)).selected[0]!.index).toBe(0);
  });

  it('통과가 하나도 없으면 빈 결과', () => {
    const { selected } = selectTopics([s(0, 1, 1, 1), s(1, 2, 2, 2)], capOnly(3));
    expect(selected).toEqual([]);
  });
});

describe('config 를 배포 없이 바꿀 수 있다 (2.6, D-61)', () => {
  // 총점 15, 12, 10, 10, 12, 10, 11 — 전부 임계 통과, 분야는 전부 다르다
  const scored = [
    s(0, 5, 5, 5),
    s(1, 4, 4, 4),
    s(2, 4, 3, 3),
    s(3, 3, 4, 3),
    s(4, 4, 4, 4),
    s(5, 3, 3, 4),
    s(6, 4, 4, 3),
  ];

  it('기본 프로필(two)은 상한 2 에서 자른다', () => {
    expect(selectTopics(scored).selected).toHaveLength(2);
  });

  it('프로필을 one 으로 바꾸면 1편만 고른다', () => {
    process.env.TECHNOW_PROFILE = 'one';
    expect(selectTopics(scored).selected).toHaveLength(1);
  });

  it('임계값을 올리면 선정 결과가 바뀐다', () => {
    process.env.TECHNOW_THRESHOLD_TOTAL = '13';
    // 15, 12, 10, 10, 12, 10, 11 중 13 이상은 하나
    expect(selectTopics(scored).selected).toHaveLength(1);
  });

  it('축 하한을 올리면 선정 결과가 바뀐다', () => {
    process.env.TECHNOW_MIN_AXIS = '5';
    // 축이 전부 5 인 건 (5,5,5) 하나
    expect(selectTopics(scored).selected).toHaveLength(1);
  });

  it('잘못된 값은 무시하고 기본값을 쓴다', () => {
    // 오타로 파이프라인이 멈추면 안 된다
    process.env.TECHNOW_THRESHOLD_TOTAL = '열';
    expect(thresholds.total).toBe(10);
  });

  it('모르는 프로필 이름이면 기본값(two)', () => {
    process.env.TECHNOW_PROFILE = 'five';
    expect(thresholds.dailyCap).toBe(2);
  });

  it('빈 문자열도 기본값', () => {
    process.env.TECHNOW_PROFILE = '';
    expect(thresholds.dailyCap).toBe(2);
  });
});

describe('summarizeSelection', () => {
  it('사유별로 집계한다', () => {
    const scored = [s(0, 1, 1, 1), s(1, 5, 5, 2), s(2, 5, 5, 5), s(3, 4, 4, 4)];
    const { entries } = selectTopics(scored, capOnly(1));
    expect(summarizeSelection(entries)).toEqual({
      selected: 1,
      passedThreshold: 2,
      belowTotal: 1,
      belowAxis: 1,
      overCap: 1,
      paperQuota: 0,
      paperDeferred: 0,
      categoryTaken: 0,
    });
  });
});

/**
 * 논문 쿼터 (D-57). 규칙 자체는 그대로다 — 5편·쿼터 2 로 적어둔 원래 테스트를
 * 프로필 모양으로 옮겼다. 분야 규칙은 끄고 쿼터만 본다.
 */
describe('논문 쿼터 (D-57)', () => {
  const quota2: PublishingProfile = { ...capOnly(5), papers: { mode: 'quota', max: 2 } };

  it('상한 안에서 논문이 쿼터를 넘지 못한다', () => {
    const scored = [0, 1, 2, 3, 4].map((k) => paper(k, 15));
    const { selected, entries } = selectTopics(scored, quota2);

    expect(selected).toHaveLength(2);
    expect(summarizeSelection(entries).paperQuota).toBe(3);
  });

  it('쿼터에 막힌 자리를 비논문이 채운다', () => {
    const scored = [paper(0, 15), paper(1, 15), paper(2, 15), event(3, 12), s(4, 4, 4, 3, 'trend')];
    const { selected } = selectTopics(scored, quota2);

    expect(selected).toHaveLength(4);
    expect(selected.filter((x) => x.kind === 'paper')).toHaveLength(2);
  });

  it('비논문이 마르면 상한에 못 미친다 — 의도된 손해다', () => {
    const scored = [0, 1, 2, 3, 4].map((k) => paper(k, 15));
    expect(selectTopics(scored, quota2).selected).toHaveLength(2);
  });

  it('논문이 아니면 쿼터와 무관하다', () => {
    const scored = [0, 1, 2, 3, 4].map((k) => event(k, 15));
    expect(selectTopics(scored, quota2).selected).toHaveLength(5);
  });

  it('쿼터에 막힌 것도 임계는 통과한 것으로 센다', () => {
    // 점수가 모자란 것과 쿼터에 막힌 것은 완전히 다른 사유다
    const scored = [0, 1, 2].map((k) => paper(k, 15));
    const summary = summarizeSelection(selectTopics(scored, quota2).entries);

    expect(summary.passedThreshold).toBe(3);
    expect(summary.belowTotal).toBe(0);
    expect(summary.paperQuota).toBe(1);
  });
});

/**
 * 걷는 판정 (D-61).
 *
 * 선정은 조사 실패를 겪으며 걸어야 결과가 정해진다. 여기는 **성공/실패 시퀀스**로
 * 규칙이 실제로 만들어진 것을 제약하는지 본다 — 첫 선발만 제약하던 버그가 여기서 났다.
 */
describe('걷는 판정 — 2편 프로필 (D-61)', () => {
  const two = PROFILES.two;

  it('09-14 회귀: 조사 실패로 내려가도 논문 쿼터를 지나치지 않는다', () => {
    // 논문 A 가 만들어진 뒤 비논문 B 가 조사에 실패한다.
    // 예전 코드는 여기서 순위만 보고 논문 C 로 내려갔다
    const scored = [
      paper(0, 15, 'health-biotech'),
      event(1, 14, 'space-astronomy'),
      paper(2, 13, 'climate-energy'),
      event(3, 12, 'ai-computing'),
    ];
    const { attempts, built, reasonOf } = walk(scored, two, (t) => (t.index === 1 ? null : t.category));

    expect(attempts).toEqual([0, 1, 3]);
    expect(built.filter((b) => b.kind === 'paper')).toHaveLength(1);
    expect(reasonOf(2)).toBe('paper-quota');
  });

  it('분야가 겹치는 후보를 건너뛰고 다음 분야로 간다', () => {
    const scored = [
      event(0, 15, 'health-biotech'),
      event(1, 14, 'health-biotech'),
      event(2, 13, 'space-astronomy'),
    ];
    const { attempts, reasonOf } = walk(scored, two);

    expect(attempts).toEqual([0, 2]);
    expect(reasonOf(1)).toBe('category-taken');
  });

  it('분야 판정은 채점의 예측이 아니라 만들어진 기사의 실제 분야를 본다', () => {
    // A 는 우주로 예측됐지만 작성이 물리로 정했다.
    // 그러면 물리로 예측된 B 가 막히고, 우주로 예측된 C 는 들어간다
    const scored = [
      event(0, 15, 'space-astronomy'),
      event(1, 14, 'physics-materials'),
      event(2, 13, 'space-astronomy'),
    ];
    const { attempts, reasonOf } = walk(scored, two, (t) =>
      t.index === 0 ? 'physics-materials' : t.category,
    );

    expect(attempts).toEqual([0, 2]);
    expect(reasonOf(1)).toBe('category-taken');
  });

  it('조사에 실패한 기사의 분야는 막지 않는다 — 만들어지지 않았다', () => {
    const scored = [event(0, 15, 'health-biotech'), event(1, 14, 'health-biotech')];
    const { attempts, built } = walk(scored, two, (t) => (t.index === 0 ? null : t.category));

    expect(attempts).toEqual([0, 1]);
    expect(built).toHaveLength(1);
  });

  it('상한이 차면 걷기가 멈춘다', () => {
    const scored = [0, 1, 2, 3, 4].map((k) => event(k, 15));
    const { attempts, reasonOf } = walk(scored, two);

    expect(attempts).toHaveLength(2);
    expect(reasonOf(2)).toBe('over-cap');
  });

  it('시도한 것은 실패해도 selected 로 남는다 — 로그의 시도 수가 사라지면 안 된다', () => {
    const scored = [event(0, 15, 'health-biotech'), event(1, 14, 'space-astronomy'), event(2, 13, 'ai-computing')];
    const { entries } = walk(scored, two, (t) => (t.index === 0 ? null : t.category));

    expect(entries.filter((e) => e.selected).map((e) => e.score.index)).toEqual([0, 1, 2]);
    expect(entries.find((e) => e.score.index === 0)?.reason).toBeNull();
  });
});

describe('걷는 판정 — 1편 프로필 (D-61)', () => {
  const one = PROFILES.one;

  it('비논문이 논문보다 점수가 낮아도 비논문을 먼저 시도한다', () => {
    const scored = [paper(0, 15), event(1, 11)];
    const { attempts, built } = walk(scored, one);

    expect(attempts).toEqual([1]);
    expect(built[0]!.kind).toBe('event');
  });

  it('비논문이 전부 조사에 실패하면 그때 논문으로 내려간다', () => {
    // "비논문이 없는 날" 이 아니라 "비논문이 하나도 안 되는 날" 이다
    const scored = [paper(0, 15), event(1, 13), event(2, 11)];
    const { attempts, built } = walk(scored, one, (t) => (t.kind === 'event' ? null : t.category));

    expect(attempts).toEqual([1, 2, 0]);
    expect(built).toEqual([{ kind: 'paper', category: scored[0]!.category }]);
  });

  it('비논문이 하나라도 만들어지면 논문은 시도하지 않는다', () => {
    const scored = [paper(0, 15), event(1, 13), event(2, 11)];
    const { attempts } = walk(scored, one, (t) => (t.index === 1 ? null : t.category));

    expect(attempts).toEqual([1, 2]);
  });

  it('논문을 미룬 동안의 사유는 paper-deferred 다', () => {
    const scored = [paper(0, 15), event(1, 13)];
    const ranked = rankPassing(scored);
    // 아무것도 만들어지기 전: 논문은 비논문이 남아 있어 미뤄진다
    const entries = finalizeEntries(scored, ranked, new Set(), [], one);

    expect(entries.find((e) => e.score.index === 0)?.reason).toBe('paper-deferred');
  });

  it('비논문이 자리를 채운 뒤에도 논문의 사유는 paper-deferred 다 — over-cap 이 아니다', () => {
    // 논문이 떨어진 이유는 "비논문을 우선했기 때문" 이다. 걷기가 끝난 시점에 자리가 차 있다고
    // over-cap 으로 적으면 로그가 틀린다 (ranking:sim 이 보류 0 으로 보여줘서 찾았다)
    const scored = [paper(0, 15), event(1, 13), event(2, 12)];
    const { attempts, reasonOf } = walk(scored, one);

    expect(attempts).toEqual([1]);
    expect(reasonOf(0)).toBe('paper-deferred');
    // 비논문끼리는 그냥 자리가 없었던 것이다
    expect(reasonOf(2)).toBe('over-cap');
  });

  it('논문뿐인 날은 논문을 고른다', () => {
    const scored = [paper(0, 15), paper(1, 13)];
    const { attempts } = walk(scored, one);

    expect(attempts).toEqual([0]);
  });
});
