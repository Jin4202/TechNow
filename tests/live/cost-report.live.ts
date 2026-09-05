import { describe, expect, it } from 'vitest';

import { budget } from '@/config/budget';
import { recentRunCosts } from '@/db/pipeline-runs';
import { createServiceClient } from '@/db/supabase/service';
import { projectMonthlyCost } from '@/pipeline/cost-projection';

/**
 * 비용 리포트 (로드맵 3.16). 실행: pnpm cost:report
 *
 * 아무것도 호출하지 않는다 — pipeline_runs 를 읽기만 한다. 무료다.
 *
 * `daily:live` 가 끝에 DB 를 비우므로, 여기서 뭔가 보려면 클라우드 DB 를 향하거나
 * 로컬에서 파이프라인을 돌린 직후여야 한다.
 */
describe('비용 리포트', () => {
  it('최근 런의 고정비/변동비를 보여준다', async () => {
    const runs = await recentRunCosts(createServiceClient());

    if (runs.length === 0) {
      console.log('\npipeline_runs 가 비어 있다. 파이프라인을 한 번 돌려야 한다');
      return;
    }

    console.log('\n날짜        상태     기사  고정비   변동비   편당    검색 페이지');
    for (const r of runs) {
      const p = projectMonthlyCost({
        costFixed: r.costFixed,
        costVariable: r.costVariable,
        articlesBuilt: r.articlesBuilt,
      });
      const perArticle = p.variablePerArticle === null ? '   —  ' : `$${p.variablePerArticle.toFixed(3)}`;
      console.log(
        `${r.startedAt.slice(0, 10)}  ${r.status.padEnd(8)} ${String(r.articlesBuilt).padStart(2)}  ` +
          `$${r.costFixed.toFixed(4)}  $${r.costVariable.toFixed(4)}  ${perArticle}  ` +
          `${String(r.searchCalls).padStart(3)} ${String(r.pagesFetched).padStart(4)}`,
      );
    }

    // 성공한 런만 평균에 넣는다. 실패한 런은 도중에 멈춰 비용이 왜곡된다
    const ok = runs.filter((r) => r.status === 'success');
    if (ok.length === 0) return;

    const avgFixed = ok.reduce((s, r) => s + r.costFixed, 0) / ok.length;
    const avgVariable = ok.reduce((s, r) => s + r.costVariable, 0) / ok.length;
    const articles = ok.reduce((s, r) => s + r.articlesBuilt, 0);
    const projection = projectMonthlyCost({
      costFixed: avgFixed,
      costVariable: avgVariable,
      articlesBuilt: Math.round(articles / ok.length),
    });

    console.log(
      `\n성공 런 ${ok.length}회 평균 — 고정비 $${avgFixed.toFixed(4)}/일, 변동비 $${avgVariable.toFixed(4)}/일`,
    );
    console.log(
      `월 환산 $${projection.projectedMonthlyUsd} / 예산 $${budget.monthlyUsd} ` +
        `(${(projection.ratio * 100).toFixed(0)}%)${projection.overBudget ? ' ← 초과' : ''}`,
    );

    expect(avgFixed).toBeGreaterThan(0);
  });
});
