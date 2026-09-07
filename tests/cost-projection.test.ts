import { describe, expect, it } from 'vitest';

import { budget } from '@/config/budget';
import { coverUsdPerImage } from '@/config/covers';
import { projectMonthlyCost, variableCostUsd } from '@/pipeline/cost-projection';

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
    // 3편 만들려다 1편은 근거 검증에서 깨진 날 (D-21).
    // 만들어진 기사는 2편인데 비용은 3편치가 나갔다 — 편당 단가가 그만큼 올라간다
    const p = projectMonthlyCost({ costFixed: 0.16, costVariable: 0.7, articlesBuilt: 2 });

    expect(p.variablePerArticle).toBe(0.35);
    expect(p.projectedMonthlyUsd).toBe(25.8);
    // 예산 판정은 금액 리터럴이 아니라 예산과의 비교다. 예산은 바뀐다 (D-36, D-46)
    expect(p.overBudget).toBe(25.8 > budget.monthlyUsd);
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

/**
 * 변동비에 이미지가 들어가는지 (2026-09-07).
 *
 * 예전에는 `cost_images` 에 장수만 저장하고 달러로 환산하지 않아 월 추정에서
 * 통째로 빠져 있었다 (D-49, D-52). schnell 시절 월 $0.45 라 무시할 수 있었는데
 * Ultra 로 바꾸며 장당 20배가 됐다. **틀린 계기로 최적화하면 엉뚱한 곳을 고친다.**
 */
describe('variableCostUsd', () => {
  const none = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  it('이미지가 변동비에 잡힌다', () => {
    const withImages = variableCostUsd({ haiku: none, sonnet: none, imagesGenerated: 5 });

    expect(withImages, '이미지만 있어도 0 이 아니다').toBeGreaterThan(0);
    expect(withImages).toBeCloseTo(5 * coverUsdPerImage, 6);
  });

  it('토큰 비용에 더해진다 — 덮어쓰지 않는다', () => {
    const tokens = { ...none, inputTokens: 10_000, outputTokens: 5_000 };
    const noImage = variableCostUsd({ haiku: tokens, sonnet: tokens, imagesGenerated: 0 });
    const oneImage = variableCostUsd({ haiku: tokens, sonnet: tokens, imagesGenerated: 1 });

    expect(noImage).toBeGreaterThan(0);
    expect(oneImage - noImage).toBeCloseTo(coverUsdPerImage, 6);
  });

  it('모델별 단가를 나눠 쓴다 — 합쳐서 한 단가로 계산하지 않는다', () => {
    // 같은 사용량이면 Sonnet 이 Haiku 보다 비싸다. 합산하면 이 차이가 사라진다
    const tokens = { ...none, inputTokens: 1_000_000, outputTokens: 0 };
    const haikuOnly = variableCostUsd({ haiku: tokens, sonnet: none, imagesGenerated: 0 });
    const sonnetOnly = variableCostUsd({ haiku: none, sonnet: tokens, imagesGenerated: 0 });

    expect(sonnetOnly).toBeGreaterThan(haikuOnly);
  });
});
