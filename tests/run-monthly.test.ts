import { describe, expect, it, vi } from 'vitest';

import { runMonthlySummaries } from '@/pipeline/run-monthly';

import type { AnthropicClient } from '@/clients/anthropic';
import type { ServiceClient } from '@/db/supabase/service';

/**
 * 월간 요약 런 (로드맵 6.6).
 *
 * 확인하는 것: **한 사용자의 실패가 다른 사용자를 막지 않는다.**
 * 요약은 사용자별로 독립인데 여기가 뚫리면 첫 사용자가 깨진 달에
 * 아무도 요약을 못 받는다.
 */

const scrapsByUser = vi.hoisted(() => vi.fn());
const saveSummary = vi.hoisted(() => vi.fn());
const summarize = vi.hoisted(() => vi.fn());

vi.mock('@/db/monthly-scraps', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  scrapsByUserForMonth: scrapsByUser,
}));
vi.mock('@/db/monthly-summaries', () => ({ saveSummary }));
vi.mock('@/pipeline/summarize/monthly-summary', () => ({ summarizeMonth: summarize }));
vi.mock('@/db/pipeline-runs', () => ({
  startRun: async () => 'run-1',
  finishRun: async () => {},
}));

const db = {} as ServiceClient;
const claude = {} as AnthropicClient;

const usage = {
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

function user(id: string) {
  return {
    userId: id,
    locale: 'en' as const,
    articles: [
      {
        articleId: `a-${id}`,
        slug: `s-${id}`,
        category: 'space-astronomy' as const,
        title: 'T',
        oneLineSummary: 'S',
      },
    ],
  };
}

describe('runMonthlySummaries', () => {
  it('스크랩이 있는 사용자마다 요약을 저장한다', async () => {
    scrapsByUser.mockResolvedValue([user('u1'), user('u2')]);
    summarize.mockResolvedValue({ markdown: '# summary', articleIds: ['a'], failure: null, usage });
    saveSummary.mockResolvedValue(undefined);

    const result = await runMonthlySummaries(db, claude, '2026-09-01');

    expect(result.users).toBe(2);
    expect(result.summariesWritten).toBe(2);
    expect(saveSummary).toHaveBeenCalledTimes(2);
  });

  it('스크랩이 없는 달에는 아무것도 하지 않는다 (기획서 §2.6)', async () => {
    scrapsByUser.mockResolvedValue([]);
    summarize.mockClear();

    const result = await runMonthlySummaries(db, claude, '2026-09-01');

    expect(result.users).toBe(0);
    expect(result.summariesWritten).toBe(0);
    // 모델을 부르지 않는다. 빈 달에 돈을 쓰지 않는다
    expect(summarize).not.toHaveBeenCalled();
  });

  it('한 사용자가 깨져도 나머지는 받는다', async () => {
    scrapsByUser.mockResolvedValue([user('u1'), user('u2'), user('u3')]);
    summarize
      .mockResolvedValueOnce({ markdown: null, articleIds: [], failure: 'unparsable', usage })
      .mockResolvedValue({ markdown: '# summary', articleIds: ['a'], failure: null, usage });
    saveSummary.mockClear();
    saveSummary.mockResolvedValue(undefined);

    const result = await runMonthlySummaries(db, claude, '2026-09-01');

    expect(result.summariesWritten).toBe(2);
    expect(result.skipped).toEqual([{ userId: 'u1', reason: 'unparsable' }]);
  });

  it('저장이 던져도 다음 사용자로 넘어간다', async () => {
    scrapsByUser.mockResolvedValue([user('u1'), user('u2')]);
    summarize.mockResolvedValue({ markdown: '# summary', articleIds: ['a'], failure: null, usage });
    saveSummary.mockReset();
    saveSummary
      .mockRejectedValueOnce(new Error('저장 실패'))
      .mockResolvedValue(undefined);

    const result = await runMonthlySummaries(db, claude, '2026-09-01');

    expect(result.summariesWritten).toBe(1);
    expect(result.skipped[0]?.userId).toBe('u1');
  });

  it('비용을 합산해 돌려준다', async () => {
    scrapsByUser.mockResolvedValue([user('u1'), user('u2')]);
    summarize.mockResolvedValue({ markdown: '# s', articleIds: ['a'], failure: null, usage });
    saveSummary.mockReset();
    saveSummary.mockResolvedValue(undefined);

    const result = await runMonthlySummaries(db, claude, '2026-09-01');

    // 사용자 2명 × (입력 100 + 출력 50) 토큰
    expect(result.usage.inputTokens).toBe(200);
    expect(result.costUsd).toBeGreaterThan(0);
  });
});
