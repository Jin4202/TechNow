import { describe, expect, it } from 'vitest';

import { splitByCategory, summarizeMonth, SPLIT_THRESHOLD } from '@/pipeline/summarize/monthly-summary';

import type { AnthropicClient } from '@/clients/anthropic';
import type { SummaryArticle } from '@/pipeline/summarize/monthly-summary';

/**
 * 월간 요약 (로드맵 6.4, 6.5).
 *
 * 모델은 문장만 쓰고 구조는 코드가 만든다. 그래서 여기서 확인하는 것은
 * **담아둔 기사가 하나도 빠지지 않는가** 다 — 사용자가 직접 고른 것들이고,
 * 요약에서 말없이 사라지면 그것을 알아챌 방법이 없다.
 */

function article(n: number, category: SummaryArticle['category']): SummaryArticle {
  return {
    articleId: `article-${n}`,
    slug: `slug-${n}`,
    category,
    title: `Title ${n}`,
    oneLineSummary: `Summary ${n}.`,
  };
}

function fakeClaude(build: (calls: number) => unknown) {
  let calls = 0;
  const prompts: string[] = [];

  const claude = {
    messages: {
      parse: async ({ messages }: { messages: { content: string }[] }) => {
        prompts.push(messages[0]!.content);
        calls += 1;
        return {
          parsed_output: build(calls),
          usage: {
            input_tokens: 800,
            output_tokens: 300,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  };

  return { claude: claude as unknown as AnthropicClient, prompts, callCount: () => calls };
}

const fullNotes = (count: number) => ({
  intro: 'A month of space and biology.',
  categoryNotes: [{ category: 'space-astronomy', note: 'Two launches.' }],
  articleNotes: Array.from({ length: count }, (_, i) => ({
    ordinal: i + 1,
    text: `What article ${i + 1} said.`,
  })),
});

describe('summarizeMonth', () => {
  it('카테고리 소제목과 기사 링크가 있는 마크다운을 낸다', async () => {
    const articles = [article(1, 'space-astronomy'), article(2, 'health-biotech')];
    const { claude } = fakeClaude(() => fullNotes(2));

    const result = await summarizeMonth(claude, articles, 'en');

    expect(result.failure).toBeNull();
    expect(result.markdown).toContain('A month of space and biology.');
    expect(result.markdown).toContain('## Space & Astronomy');
    expect(result.markdown).toContain('[Title 1](slug-1)');
    expect(result.articleIds).toEqual(['article-1', 'article-2']);
  });

  it('한국어 요약은 카테고리 이름도 한국어다', async () => {
    const { claude } = fakeClaude(() => fullNotes(1));
    const result = await summarizeMonth(claude, [article(1, 'space-astronomy')], 'ko');

    expect(result.markdown).toContain('## 우주·천문');
  });

  it('설명이 빠진 기사는 한 줄 요약으로 채운다', async () => {
    // 담아둔 기사가 요약에서 통째로 사라지지 않게 한다
    const { claude } = fakeClaude(() => ({ ...fullNotes(1), articleNotes: [{ ordinal: 1, text: 'Only the first.' }] }));

    const result = await summarizeMonth(claude, [article(1, 'space-astronomy'), article(2, 'space-astronomy')], 'en');

    expect(result.markdown).toContain('Only the first.');
    expect(result.markdown).toContain('Summary 2.');
    expect(result.articleIds).toHaveLength(2);
  });

  it('설명이 하나도 없으면 실패다', async () => {
    const { claude } = fakeClaude(() => ({ ...fullNotes(0), articleNotes: [] }));
    const result = await summarizeMonth(claude, [article(1, 'space-astronomy')], 'en');

    expect(result.failure).toBe('no-article-notes');
    expect(result.markdown).toBeNull();
  });

  it('스크랩이 없으면 요약을 만들지 않는다 (기획서 §2.6)', async () => {
    const { claude, callCount } = fakeClaude(() => fullNotes(0));
    const result = await summarizeMonth(claude, [], 'en');

    expect(result.failure).toBe('no-article-notes');
    // 모델을 부르지도 않는다. 빈 달에 돈을 쓰지 않는다
    expect(callCount()).toBe(0);
  });

  it('스키마에 맞지 않으면 실패다', async () => {
    const { claude } = fakeClaude(() => ({ intro: 'x' }));
    const result = await summarizeMonth(claude, [article(1, 'space-astronomy')], 'en');

    expect(result.failure).toBe('unparsable');
  });

  it('사용량을 합산해 돌려준다', async () => {
    const { claude } = fakeClaude(() => fullNotes(1));
    const result = await summarizeMonth(claude, [article(1, 'space-astronomy')], 'en');

    expect(result.usage.inputTokens).toBe(800);
  });
});

describe('100건 이상은 카테고리별로 나눈다 (6.5)', () => {
  /** 세 카테고리에 걸친 대량 세트 */
  const categories = ['space-astronomy', 'health-biotech', 'ai-computing'] as const;
  const many = Array.from({ length: SPLIT_THRESHOLD + 20 }, (_, i) =>
    article(i + 1, categories[i % categories.length]!),
  );

  it('splitByCategory 가 카테고리 수만큼 묶음을 만든다', () => {
    const groups = splitByCategory(many);

    expect(groups).toHaveLength(categories.length);
    expect(groups.flat()).toHaveLength(many.length);
  });

  it('임계값을 넘으면 호출이 카테고리 수만큼이다', async () => {
    const { claude, callCount } = fakeClaude(() => fullNotes(50));
    const result = await summarizeMonth(claude, many, 'en');

    expect(callCount()).toBe(categories.length);
    // 나눠 불러도 기사는 하나도 빠지지 않는다
    expect(result.articleIds).toHaveLength(many.length);
  });

  it('임계값 아래면 한 번만 부른다', async () => {
    const { claude, callCount } = fakeClaude(() => fullNotes(3));
    await summarizeMonth(claude, many.slice(0, 3), 'en');

    expect(callCount()).toBe(1);
  });

  it('나눠 불러도 도입은 하나다', async () => {
    const { claude } = fakeClaude(() => fullNotes(50));
    const result = await summarizeMonth(claude, many, 'en');

    const intros = result.markdown!.split('A month of space and biology.').length - 1;
    expect(intros).toBe(1);
  });
});
