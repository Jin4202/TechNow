import { describe, expect, it } from 'vitest';

import { budget } from '@/config/budget';
import { projectMonthlyCost } from '@/pipeline/cost-projection';

/**
 * D-07 의 예산 계산식을 고정한다.
 *
 * 이 식이 조용히 바뀌면 예산을 넘기고도 넘긴 줄 모르게 된다.
 */
describe('projectMonthlyCost', () => {
  it('고정비는 30일, 변동비는 그날 쓴 만큼 30일치로 환산한다', () => {
    const p = projectMonthlyCost({ costFixed: 0.16, costVariable: 0.36, articlesBuilt: 3 });

    // 0.16×30 = 4.8, 0.36×30 = 10.8
    expect(p.projectedMonthlyUsd).toBe(15.6);
    expect(p.variablePerArticle).toBe(0.12);
    expect(p.overBudget).toBe(false);
  });

  it('기사가 0건이어도 고정비는 발생한다', () => {
    const p = projectMonthlyCost({ costFixed: 0.16, costVariable: 0, articlesBuilt: 0 });

    expect(p.projectedMonthlyUsd).toBe(4.8);
    // 편당 비용은 정의되지 않는다. 0 으로 두면 "공짜"로 읽힌다
    expect(p.variablePerArticle).toBeNull();
  });

  it('실패한 조사의 변동비도 계산에 들어간다', () => {
    // 3편 만들려다 1편은 근거 검증에서 깨진 날 (D-21)
    const p = projectMonthlyCost({ costFixed: 0.16, costVariable: 0.6, articlesBuilt: 2 });

    expect(p.variablePerArticle).toBe(0.3);
    expect(p.projectedMonthlyUsd).toBe(22.8);
    expect(p.overBudget).toBe(true);
  });

  it('예산의 alertRatio 를 넘으면 알린다', () => {
    const perDay = (budget.monthlyUsd * budget.alertRatio) / 30;
    const p = projectMonthlyCost({ costFixed: perDay, costVariable: 0, articlesBuilt: 1 });

    expect(p.ratio).toBeCloseTo(budget.alertRatio, 3);
    expect(p.shouldAlert).toBe(true);
    expect(p.overBudget).toBe(false);
  });

  it('예산 이내면 알리지 않는다', () => {
    const p = projectMonthlyCost({ costFixed: 0.16, costVariable: 0.36, articlesBuilt: 3 });
    expect(p.shouldAlert).toBe(false);
  });
});
