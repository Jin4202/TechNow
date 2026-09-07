import { estimateCost, type TokenUsage } from '@/clients/anthropic';
import { budget } from '@/config/budget';
import { coverUsdPerImage } from '@/config/covers';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_HAIKU,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';

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

const MULTIPLIERS = { cacheRead: CACHE_READ_MULTIPLIER, cacheWrite: CACHE_WRITE_MULTIPLIER };

/**
 * 한 런의 변동비 (USD) — 조사~작성에 붙는 비용.
 *
 * **커버 이미지가 여기 들어간다** (2026-09-07). 예전에는 `cost_images` 에 장수만
 * 저장하고 달러로 환산하지 않아 월 추정에서 통째로 빠져 있었다 (D-49, D-52).
 * schnell 시절 월 $0.45 라 무시할 수 있었는데 Ultra 로 바꾸며 장당 단가가
 * 20배가 됐다 — 하루 5장이면 월 $9 다. **틀린 계기로 최적화하면 엉뚱한 곳을 고친다.**
 *
 * 모델별로 나눠 받는 이유는 단가가 다르기 때문이다. 합쳐서 한 단가로 계산하면
 * Haiku 부분이 Sonnet 단가로 부풀려진다.
 *
 * **Brave 검색은 없다.** 무료 티어(월 2,000회) 안이라 $0 이고 0 을 더하는 줄은
 * 잡음이다. 하루 35회면 월 1,050회로 절반쯤 쓴다 — 상한에 가까워지면 항목을 만든다.
 */
export function variableCostUsd(input: {
  haiku: TokenUsage;
  sonnet: TokenUsage;
  imagesGenerated: number;
}): number {
  return (
    estimateCost(input.haiku, PRICING[MODEL_HAIKU], MULTIPLIERS) +
    estimateCost(input.sonnet, PRICING[MODEL_SONNET], MULTIPLIERS) +
    input.imagesGenerated * coverUsdPerImage
  );
}

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
