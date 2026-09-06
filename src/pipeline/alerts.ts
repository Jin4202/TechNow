import { budget } from '@/config/budget';

import type { CostProjection } from '@/pipeline/cost-projection';

/**
 * 무엇을 알릴지 정하는 순수 함수들 (로드맵 7.4, 7.5).
 *
 * 판단은 여기, 전달은 `src/trigger/alert.ts` 다. 나누는 이유는 CLAUDE.md §3 —
 * Trigger.dev 없이 테스트할 수 있어야 한다. 알림 조건은 조용히 틀리기 쉽다
 * (안 울리거나, 매일 울리거나).
 */

export interface Alert {
  kind: 'budget' | 'articles-failed' | 'no-articles' | 'summaries-skipped';
  message: string;
  data: Record<string, unknown>;
}

/**
 * 일간 런이 끝난 뒤 알릴 것.
 *
 * 여러 개가 동시에 참일 수 있다 — 기사가 0건이면서 예산도 넘을 수 있다.
 * 하나로 합치지 않는다. 원인이 둘이면 알림도 둘이다.
 */
export function dailyAlerts(input: {
  projection: CostProjection;
  articlesBuilt: number;
  buildAttempts: number;
}): Alert[] {
  const alerts: Alert[] = [];

  if (input.projection.shouldAlert) {
    alerts.push({
      kind: 'budget',
      message: `이 페이스면 월 $${input.projection.projectedMonthlyUsd} (예산 $${budget.monthlyUsd})`,
      data: {
        projectedMonthlyUsd: input.projection.projectedMonthlyUsd,
        monthlyUsd: budget.monthlyUsd,
        variablePerArticle: input.projection.variablePerArticle,
        ratio: input.projection.ratio,
      },
    });
  }

  // 시도는 했는데 하나도 못 만든 날. 후보가 없어서 시도조차 안 한 날(0회)은
  // 조용한 날이지 사고가 아니다 (기획서 §2.1)
  if (input.articlesBuilt === 0 && input.buildAttempts > 0) {
    alerts.push({
      kind: 'no-articles',
      message: `${input.buildAttempts}개 토픽을 시도했지만 기사가 0건이다`,
      data: { buildAttempts: input.buildAttempts },
    });
  }

  return alerts;
}

/**
 * 발행 배치가 끝난 뒤 알릴 것.
 *
 * hold-back 2회로 포기한 기사는 알린다 (기획서 §2.5 — "log it, and alert").
 * 조사·작성 비용을 이미 쓴 기사가 발행되지 못하고 사라지는 것이므로
 * 조용히 넘어가면 안 된다.
 */
export function publishAlerts(input: { failed: number; heldBack: number }): Alert[] {
  if (input.failed === 0) return [];

  return [
    {
      kind: 'articles-failed',
      message: `자산을 못 채워 포기한 기사 ${input.failed}건`,
      data: { failed: input.failed, heldBack: input.heldBack },
    },
  ];
}

/** 월간 요약에서 건너뛴 사용자가 있으면 알린다 */
export function monthlyAlerts(input: { skipped: number; users: number }): Alert[] {
  if (input.skipped === 0) return [];

  return [
    {
      kind: 'summaries-skipped',
      message: `월간 요약 ${input.users}명 중 ${input.skipped}명 실패`,
      data: { skipped: input.skipped, users: input.users },
    },
  ];
}
