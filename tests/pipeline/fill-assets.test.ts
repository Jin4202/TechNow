import { describe, expect, it } from 'vitest';

import { fillAssets } from '@/pipeline/fill-assets';

import type { AnthropicClient } from '@/clients/anthropic';
import type { ServiceClient } from '@/db/supabase/service';

/**
 * 필수 자산 채우기 (로드맵 4.4, 4.6).
 *
 * 확인하려는 것 하나: **번역이 실패하면 기사가 발행 대기로 올라가지 않는다.**
 * 여기가 뚫리면 한국어판 없는 기사가 그날 아침 발행에 섞여 들어간다.
 */

const article = {
  id: 'article-1',
  title: 'Underground detector records a flash it cannot explain',
  oneLineSummary: 'The odds that background noise produced the signal are one in two hundred.',
  sections: [
    {
      heading: 'What the detector saw',
      paragraphs: ['The experiment recorded a single flash.'],
      sources: [1, 2],
    },
  ],
  locales: [] as string[],
};

/** 번역 응답을 정해 주는 가짜 Claude. 호출 수를 센다 */
function fakeClaude(outputs: unknown[]) {
  const calls: unknown[] = [];

  const claude = {
    messages: {
      parse: async ({ messages }: { messages: unknown[] }) => {
        calls.push(messages);
        return {
          parsed_output: outputs[Math.min(calls.length - 1, outputs.length - 1)],
          usage: {
            input_tokens: 100,
            output_tokens: 200,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  };

  return { claude: claude as unknown as AnthropicClient, calls };
}

/** insert 와 update 만 받는 가짜 DB */
function fakeDb() {
  const inserted: Record<string, unknown>[] = [];
  const promoted: string[] = [];

  const db = {
    from(table: string) {
      if (table === 'article_translations') {
        return {
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row);
            return { error: null };
          },
        };
      }

      // articles: update(...).eq(...).eq(...).select(...)
      return {
        update: (patch: { status: string }) => ({
          eq: (_column: string, value: string) => ({
            eq: () => ({
              select: async () => {
                if (patch.status === 'ready') promoted.push(value);
                return { data: [{ id: value }], error: null };
              },
            }),
          }),
        }),
      };
    },
  };

  return { db: db as unknown as ServiceClient, inserted, promoted };
}

const goodTranslation = {
  title: '지하 검출기가 설명할 수 없는 섬광을 기록했습니다',
  one_line_summary: '배경 잡음이 이 신호를 만들었을 확률은 200분의 1입니다.',
  sections: [
    {
      heading: '검출기가 본 것',
      paragraphs: ['실험은 단 한 번의 섬광을 기록했습니다.'],
      sources: [1, 2],
    },
  ],
};

describe('fillAssets', () => {
  it('번역에 성공하면 저장하고 발행 대기로 올린다', async () => {
    const { db, inserted, promoted } = fakeDb();
    const { claude } = fakeClaude([goodTranslation]);

    const result = await fillAssets(db, claude, article);

    expect(result.ready).toBe(true);
    expect(result.filled).toEqual(['korean_translation']);
    expect(inserted[0]).toMatchObject({ article_id: 'article-1', locale: 'ko' });
    expect(promoted).toEqual(['article-1']);
  });

  it('번역이 실패하면 발행 대기로 올리지 않는다', async () => {
    // 섹션 수가 원문과 다른 번역 — 4.3a 가 잡는다
    const broken = { ...goodTranslation, sections: [] };
    const { db, inserted, promoted } = fakeDb();
    const { claude, calls } = fakeClaude([broken]);

    const result = await fillAssets(db, claude, article);

    expect(result.ready, '실패한 기사는 그날 아침 발행에서 빠진다').toBe(false);
    expect(result.failures[0]?.asset).toBe('korean_translation');
    expect(inserted).toEqual([]);
    expect(promoted).toEqual([]);
    // 런 안에서 1회 재시도한다 (기획서 §2.3)
    expect(calls).toHaveLength(2);
  });

  it('첫 시도가 실패해도 두 번째가 성공하면 올라간다', async () => {
    const broken = { ...goodTranslation, sections: [] };
    const { db, promoted } = fakeDb();
    const { claude, calls } = fakeClaude([broken, goodTranslation]);

    const result = await fillAssets(db, claude, article);

    expect(result.ready).toBe(true);
    expect(promoted).toEqual(['article-1']);
    // 재시도 프롬프트에는 무엇이 틀렸는지가 들어간다
    expect(JSON.stringify(calls[1])).toContain('section-count');
  });

  it('이미 번역이 있으면 다시 부르지 않는다', async () => {
    // 스윕이 같은 기사를 다시 만나는 경우. 자산이 있으면 비용을 또 쓰지 않는다
    const { db, promoted } = fakeDb();
    const { claude, calls } = fakeClaude([goodTranslation]);

    const result = await fillAssets(db, claude, { ...article, locales: ['ko'] });

    expect(calls).toHaveLength(0);
    expect(result.ready).toBe(true);
    expect(promoted).toEqual(['article-1']);
  });
});
