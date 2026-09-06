import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { createServiceClient } from '@/db/supabase/service';
import { runMonthlySummaries } from '@/pipeline/run-monthly';

/**
 * 월간 요약 런 전체 (로드맵 6.6). 실행: pnpm monthly:live
 *
 * 로컬 Supabase + 실제 Claude. 사용자당 약 $0.01.
 *
 * **테스트 사용자는 비밀번호가 없다.** 파이프라인은 service 키로 돌고
 * 로그인을 하지 않으므로 FK 를 채울 행만 있으면 된다. 로그인할 수 있는
 * 계정을 만들지 않는다.
 */

const db = createServiceClient();
const claude = getAnthropic();

const USER_A = '00000000-0000-4000-9000-00000000000a';
const USER_B = '00000000-0000-4000-9000-00000000000b';
const MONTH = '2026-08-01';

/** 지난달 안에 있는 시각 */
const IN_MONTH = '2026-08-15T00:00:00Z';
/** 경계 밖 — 다음 달 첫날 */
const OUT_OF_MONTH = '2026-09-01T00:00:01Z';

async function cleanup() {
  await db.from('monthly_summaries').delete().in('user_id', [USER_A, USER_B]);
  await db.from('scraps').delete().in('user_id', [USER_A, USER_B]);
  await db.from('pipeline_runs').delete().eq('run_type', 'monthly');
}

beforeAll(async () => {
  await cleanup();

  // 발행된 기사가 있어야 스크랩할 것이 있다
  const { data: articles } = await db
    .from('articles')
    .select('id')
    .eq('status', 'published')
    .limit(3);

  expect(articles?.length, '로컬에 발행된 기사가 없다').toBeGreaterThan(0);

  await db.from('scraps').insert(
    articles!.map((article, index) => ({
      user_id: USER_A,
      article_id: article.id,
      // 마지막 하나는 달 경계 밖에 둔다 — 집계가 경계를 지키는지 본다
      scraped_at: index === articles!.length - 1 ? OUT_OF_MONTH : IN_MONTH,
    })),
  );
});

afterAll(cleanup);

describe('월간 요약 런 (6.6)', () => {
  it(
    '스크랩이 있는 사용자에게 요약을 만들고 저장한다',
    async () => {
      const result = await runMonthlySummaries(db, claude, MONTH, {
        onInfo: (message, data) => console.log(`  ${message}`, data),
        onWarn: (message, data) => console.log(`  ⚠ ${message}`, data),
      });

      console.log(
        `\n대상 ${result.users}명 → 요약 ${result.summariesWritten}건, 건너뜀 ${result.skipped.length}, $${result.costUsd}`,
      );

      expect(result.users).toBe(1);
      expect(result.summariesWritten).toBe(1);
      expect(result.skipped).toEqual([]);

      const { data: saved } = await db
        .from('monthly_summaries')
        .select('summary_text, article_ids, locale, month_start')
        .eq('user_id', USER_A)
        .single();

      expect(saved!.month_start).toBe(MONTH);
      // 경계 밖 스크랩은 빠진다
      expect(saved!.article_ids.length, '달 경계를 지키지 않았다').toBe(2);
      // 카테고리 소제목이 있는 마크다운이다
      expect(saved!.summary_text).toContain('## ');

      console.log(`\n${saved!.summary_text.slice(0, 400)}…`);
    },
    300_000,
  );

  it('스크랩이 없는 사용자는 건너뛴다 (기획서 §2.6)', async () => {
    // USER_B 는 스크랩이 없다. 대상 목록에 아예 나오지 않아야 한다
    const { data: summaries } = await db
      .from('monthly_summaries')
      .select('user_id')
      .eq('user_id', USER_B);

    expect(summaries).toEqual([]);
  });

  it('스크랩이 없는 달에는 모델을 부르지 않는다', async () => {
    // 아무도 스크랩하지 않은 달
    const result = await runMonthlySummaries(db, claude, '2020-01-01');

    expect(result.users).toBe(0);
    expect(result.summariesWritten).toBe(0);
    expect(result.costUsd).toBe(0);
  });

  it('런이 pipeline_runs 에 monthly 로 남는다', async () => {
    const { data } = await db
      .from('pipeline_runs')
      .select('run_type, status, topics_selected, notes')
      .eq('run_type', 'monthly')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    expect(data!.status).toBe('success');
    expect(data!.notes).toContain('대상');
  });

  it('다시 돌려도 요약이 중복되지 않는다', async () => {
    // 대시보드에서 손으로 다시 돌리는 경우 (기획서 §11). upsert 라 덮어쓴다
    await runMonthlySummaries(db, claude, MONTH);

    const { count } = await db
      .from('monthly_summaries')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', USER_A);

    expect(count).toBe(1);
  }, 300_000);
});
