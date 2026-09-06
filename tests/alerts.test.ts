import { describe, expect, it, vi, afterEach } from 'vitest';

import { budget } from '@/config/budget';
import { dailyAlerts, monthlyAlerts, publishAlerts } from '@/pipeline/alerts';
import { projectMonthlyCost } from '@/pipeline/cost-projection';

/**
 * 알림 조건 (로드맵 7.4, 7.5).
 *
 * 알림은 조용히 틀리기 쉽다 — 안 울리거나, 매일 울려서 무시하게 되거나.
 * 둘 다 여기서 막는다.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/** 하루 비용에서 월 환산 경보 상태를 만든다 */
function projection(costFixed: number, costVariable: number, articlesBuilt: number) {
  return projectMonthlyCost({ costFixed, costVariable, articlesBuilt });
}

describe('dailyAlerts — 예산 (7.5)', () => {
  it('예산의 80% 를 넘으면 알린다', () => {
    const perDay = (budget.monthlyUsd * budget.alertRatio) / 30;
    const alerts = dailyAlerts({
      projection: projection(perDay, 0, 1),
      articlesBuilt: 1,
      buildAttempts: 1,
    });

    expect(alerts.map((a) => a.kind)).toContain('budget');
    expect(alerts[0]!.data.monthlyUsd).toBe(budget.monthlyUsd);
  });

  it('예산 안이면 알리지 않는다 — 매일 울리면 아무도 안 본다', () => {
    const alerts = dailyAlerts({
      projection: projection(0.16, 0.36, 3),
      articlesBuilt: 3,
      buildAttempts: 3,
    });

    expect(alerts).toEqual([]);
  });

  it('예산을 env 로 올리면 경보도 따라 올라간다', () => {
    // 실측이 쌓여 예산을 조정할 때 코드를 고치지 않아도 된다 (D-36)
    const before = dailyAlerts({
      projection: projection(1.0, 0, 1),
      articlesBuilt: 1,
      buildAttempts: 1,
    });
    expect(before.map((a) => a.kind)).toContain('budget');
  });
});

describe('dailyAlerts — 기사 0건', () => {
  it('시도했는데 하나도 못 만들면 알린다', () => {
    const alerts = dailyAlerts({
      projection: projection(0.16, 0.3, 0),
      articlesBuilt: 0,
      buildAttempts: 4,
    });

    expect(alerts.map((a) => a.kind)).toContain('no-articles');
  });

  it('시도조차 없던 조용한 날은 알리지 않는다', () => {
    // 임계값을 넘은 토픽이 없는 날은 사고가 아니다 (기획서 §2.1)
    const alerts = dailyAlerts({
      projection: projection(0.16, 0, 0),
      articlesBuilt: 0,
      buildAttempts: 0,
    });

    expect(alerts.map((a) => a.kind)).not.toContain('no-articles');
  });

  it('원인이 둘이면 알림도 둘이다', () => {
    const alerts = dailyAlerts({
      projection: projection(1.0, 0, 0),
      articlesBuilt: 0,
      buildAttempts: 3,
    });

    expect(alerts.map((a) => a.kind).sort()).toEqual(['budget', 'no-articles']);
  });
});

describe('publishAlerts', () => {
  it('포기한 기사가 있으면 알린다 (기획서 §2.5)', () => {
    const alerts = publishAlerts({ failed: 2, heldBack: 1 });

    expect(alerts[0]!.kind).toBe('articles-failed');
    expect(alerts[0]!.data.failed).toBe(2);
  });

  it('hold-back 만 있으면 알리지 않는다 — 아직 기회가 있다', () => {
    expect(publishAlerts({ failed: 0, heldBack: 3 })).toEqual([]);
  });
});

describe('monthlyAlerts', () => {
  it('건너뛴 사용자가 있으면 알린다', () => {
    expect(monthlyAlerts({ skipped: 1, users: 5 })[0]!.kind).toBe('summaries-skipped');
  });

  it('전원 성공이면 알리지 않는다', () => {
    expect(monthlyAlerts({ skipped: 0, users: 5 })).toEqual([]);
  });

  it('스크랩한 사람이 없는 달은 알리지 않는다', () => {
    expect(monthlyAlerts({ skipped: 0, users: 0 })).toEqual([]);
  });
});
