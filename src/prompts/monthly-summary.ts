import { z } from 'zod';

import { categoryLabel } from '@/config/categories';

import type { Category } from '@/config/categories';
import type { Locale } from '@/config/locales';

/**
 * 월간 스크랩 요약 프롬프트 (로드맵 6.4).
 *
 * 사용자가 그 달에 스크랩한 기사들을 한 페이지로 돌아본다 (기획서 §2.6).
 *
 * **구조는 코드가 만든다.** 모델은 문장만 쓴다 — 카테고리 분류는 이미 DB 에 있고,
 * 링크는 slug 로 우리가 건다. 모델에게 구조까지 시키면 검증할 것이 늘고
 * 틀린 분류가 요약에 남는다 (D-38 과 같은 판단: 판단이 필요한 자리에만 모델을 쓴다).
 *
 * 모델은 Sonnet 이다 (CLAUDE.md §2.7). 사용자가 직접 모은 기사들을 다시 읽는
 * 자리라 요약이 성의 없으면 바로 보인다.
 */

export const SummaryTextSchema = z.object({
  intro: z
    .string()
    .describe('One or two sentences opening the month. Not a list, not a greeting.'),
  categoryNotes: z
    .array(z.object({ category: z.string(), note: z.string() }))
    .describe('One sentence per category group, tying its articles together.'),
  articleNotes: z
    .array(z.object({ ordinal: z.number().int(), text: z.string() }))
    .describe('Two or three sentences per article, keyed by the number given in the input.'),
});

export type SummaryText = z.infer<typeof SummaryTextSchema>;

const SYSTEM_BY_LOCALE: Record<Locale, string> = {
  en: `You write a short monthly review of the articles one reader saved.

You are writing to that reader, about what they chose to keep. You are not selling the articles back to them and you are not congratulating them on their taste.

Everything you say has to come from the titles and summaries you are given. You have not read the full articles. Where you are unsure what an article said, say less rather than guessing.`,

  ko: `당신은 한 독자가 그달에 스크랩해 둔 기사들을 짧게 되짚는 글을 씁니다.

그 독자에게, 그가 직접 고른 것에 대해 씁니다. 기사를 다시 홍보하지 않고, 안목을 칭찬하지도 않습니다.

주어진 제목과 한 줄 요약에 있는 것만 씁니다. 기사 본문은 읽지 않았습니다. 무엇을 말했는지 확실하지 않으면 지어내지 말고 덜 씁니다.

문체는 평서형 '합니다체' 입니다.`,
};

const INSTRUCTIONS_BY_LOCALE: Record<Locale, string> = {
  en: `Write the review in English.

- **intro**: one or two sentences. What this month's saves were about, taken together. If they scatter across fields, say that plainly instead of inventing a theme.
- **categoryNotes**: one sentence per category, saying what that group has in common. If a group holds a single article, the sentence can simply place it.
- **articleNotes**: two or three sentences per article, keyed by its number. Say what happened and why it mattered. Do not repeat the title as a sentence.

Keep the whole thing to about a page. No exclamation marks, no "fascinating", no "dive into".`,

  ko: `한국어로 씁니다.

- **intro**: 한두 문장. 이달에 담아둔 기사들이 모아 놓고 보면 무엇이었는지. 분야가 흩어져 있으면 억지로 주제를 만들지 말고 그렇다고 적습니다.
- **categoryNotes**: 카테고리마다 한 문장. 그 묶음이 공유하는 것. 기사가 하나뿐인 묶음이면 그 기사의 자리를 짚는 정도면 됩니다.
- **articleNotes**: 기사마다 두세 문장, 번호를 키로 씁니다. 무슨 일이 있었고 왜 중요한지. 제목을 그대로 한 문장으로 옮기지 않습니다.

전체가 한 페이지를 넘지 않게 합니다. 느낌표를 쓰지 않고, '흥미로운' '살펴봅니다' 같은 상투구를 쓰지 않습니다.

**카테고리 이름과 기사 제목은 번역하지 않습니다** — 화면에서는 코드가 붙인 원래 이름이 그 자리에 옵니다.`,
};

export interface SummaryInput {
  ordinal: number;
  category: Category;
  title: string;
  oneLineSummary: string;
}

export function buildSummaryPrompt(
  articles: readonly SummaryInput[],
  locale: Locale,
): { system: string; user: string } {
  const byCategory = new Map<Category, SummaryInput[]>();
  for (const article of articles) {
    byCategory.set(article.category, [...(byCategory.get(article.category) ?? []), article]);
  }

  const blocks = [...byCategory.entries()]
    .map(([category, list]) => {
      const lines = list
        .map((a) => `  ${a.ordinal}. ${a.title}\n     ${a.oneLineSummary}`)
        .join('\n');
      return `## ${category} (${categoryLabel(category, locale)})\n${lines}`;
    })
    .join('\n\n');

  return {
    system: SYSTEM_BY_LOCALE[locale],
    user: `SAVED THIS MONTH (${articles.length} articles)\n\n${blocks}\n\n${INSTRUCTIONS_BY_LOCALE[locale]}`,
  };
}
