import { budget } from '@/config/budget';

/**
 * 하루치 실측 비용을 월 예산으로 환산한다 (D-07, 로드맵 3.16a).
 *
 * 계산식은 D-07 그대로다:
 *
 *     cost_fixed × 30 + cost_variable_per_article × 기사수 × 30 <= monthlyUsd
 *
 * 고정비는 기사가 0건인 날에도 발생하므로 30일 전체에 곱하고, 변동비는
 * 기사 수에 비례한다. 그래서 한 값으로 합쳐 두면 예산 판단을 할 수 없다.
 *
 * **한 런의 값이라 표본이 1이다.** 경보가 아니라 관측이다 — 이 함수는 아무것도
 * 막지 않고, 실제 상한은 호출 지점의 카운터(`budget.searchCallsPerTopic` 등)가
 * 강제한다 (CLAUDE.md §2.6).
 */

export interface CostProjection {
  /** 이 런에서 실제로 만든 기사 수 */
  articlesBuilt: number;
  /** 기사 1편당 변동비. 0건이면 null — 나눌 수가 없다 */
  variablePerArticle: number | null;
  /** 이 페이스가 30일 이어질 때의 월 비용 */
  projectedMonthlyUsd: number;
  /** 예산 대비 비율 */
  ratio: number;
  /** 예산을 넘는가 */
  overBudget: boolean;
  /** 예산의 alertRatio 를 넘는가 */
  shouldAlert: boolean;
}

export function projectMonthlyCost(input: {
  costFixed: number;
  costVariable: number;
  articlesBuilt: number;
  days?: number;
}): CostProjection {
  const days = input.days ?? 30;
  const { articlesBuilt } = input;

  // 기사가 0건인 날의 변동비는 조사 실패분이다. 편당으로 나눌 수 없으므로
  // 그날 쓴 만큼만 그대로 30일에 곱한다
  const variablePerArticle = articlesBuilt > 0 ? input.costVariable / articlesBuilt : null;

  const projectedMonthlyUsd = input.costFixed * days + input.costVariable * days;
  const ratio = projectedMonthlyUsd / budget.monthlyUsd;

  return {
    articlesBuilt,
    variablePerArticle: variablePerArticle === null ? null : round(variablePerArticle),
    projectedMonthlyUsd: round(projectedMonthlyUsd),
    ratio: round(ratio),
    overBudget: projectedMonthlyUsd > budget.monthlyUsd,
    shouldAlert: ratio >= budget.alertRatio,
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
