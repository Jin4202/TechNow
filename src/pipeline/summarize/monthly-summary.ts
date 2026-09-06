import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { addUsage, readUsage, ZERO_USAGE, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { categoryLabel } from '@/config/categories';
import { EFFORT, models } from '@/config/models';
import { buildSummaryPrompt, SummaryTextSchema } from '@/prompts/monthly-summary';

import type { Category } from '@/config/categories';
import type { Locale } from '@/config/locales';

/**
 * 월간 스크랩 요약 (로드맵 6.4, 6.5).
 *
 * 모델은 문장만 쓴다. 카테고리로 묶고, 순서를 정하고, 링크를 거는 것은 코드다 —
 * 그래야 요약이 없는 기사나 잘못 분류된 기사가 생기지 않는다.
 *
 * 산출은 **마크다운 한 덩어리**다 (`monthly_summaries.summary_text`).
 * 우리가 만든 마크다운이라 화면(6.7)이 렌더할 부분집합이 정해져 있다 —
 * 소제목, 링크, 문단뿐이고 임의의 HTML 은 들어가지 않는다.
 */

export interface SummaryArticle {
  articleId: string;
  slug: string;
  category: Category;
  title: string;
  oneLineSummary: string;
}

export type SummaryFailure =
  /** 구조화 출력이 스키마에 맞지 않음 */
  | 'unparsable'
  /** 기사 하나도 설명하지 못함 */
  | 'no-article-notes';

export interface SummaryResult {
  markdown: string | null;
  articleIds: string[];
  failure: SummaryFailure | null;
  detail?: string;
  usage: TokenUsage;
}

/**
 * 기사가 이 수를 넘으면 카테고리별로 나눠 부른다 (기획서 §2.6, 로드맵 6.5).
 *
 * 100건을 한 번에 보내면 뒤쪽 기사의 설명이 성의없어진다 — 채점에서 본 것과
 * 같은 현상이다 (`thresholds.scoringChunkSize` 의 이유). 카테고리로 나누면
 * 묶음마다 맥락이 온전하고, 화면에서도 카테고리가 절이라 이어 붙이기 쉽다.
 */
export const SPLIT_THRESHOLD = 100;

export async function summarizeMonth(
  claude: AnthropicClient,
  articles: readonly SummaryArticle[],
  locale: Locale,
): Promise<SummaryResult> {
  if (articles.length === 0) {
    return { markdown: null, articleIds: [], failure: 'no-article-notes', detail: '스크랩 0건', usage: ZERO_USAGE };
  }

  const groups =
    articles.length >= SPLIT_THRESHOLD ? splitByCategory(articles) : [[...articles]];

  const parts: string[] = [];
  const covered: string[] = [];
  let usage = ZERO_USAGE;
  let intro: string | null = null;

  for (const group of groups) {
    const result = await summarizeGroup(claude, group, locale);
    usage = addUsage(usage, result.usage);

    if (!result.section) {
      return { markdown: null, articleIds: [], failure: result.failure, detail: result.detail, usage };
    }

    // 여러 번 부르면 intro 도 여러 개다. 첫 묶음의 것만 쓴다 —
    // 카테고리별 도입은 각 절이 이미 가지고 있다
    intro ??= result.section.intro;
    parts.push(result.section.body);
    covered.push(...result.section.articleIds);
  }

  return {
    markdown: [intro, ...parts].filter(Boolean).join('\n\n'),
    articleIds: covered,
    failure: null,
    usage,
  };
}

/** 카테고리별로 나눈다. 한 카테고리가 통째로 한 호출에 들어간다 */
export function splitByCategory(articles: readonly SummaryArticle[]): SummaryArticle[][] {
  const byCategory = new Map<Category, SummaryArticle[]>();
  for (const article of articles) {
    byCategory.set(article.category, [...(byCategory.get(article.category) ?? []), article]);
  }
  return [...byCategory.values()];
}

async function summarizeGroup(
  claude: AnthropicClient,
  articles: readonly SummaryArticle[],
  locale: Locale,
): Promise<{
  section: { intro: string; body: string; articleIds: string[] } | null;
  failure: SummaryFailure | null;
  detail?: string;
  usage: TokenUsage;
}> {
  const numbered = articles.map((article, index) => ({ ...article, ordinal: index + 1 }));
  const { system, user } = buildSummaryPrompt(numbered, locale);

  const response = await claude.messages.parse({
    model: models.monthlySummary,
    max_tokens: 4000,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: {
      format: zodOutputFormat(SummaryTextSchema),
      effort: EFFORT.monthlySummary,
    },
  });

  const usage = readUsage(response.usage);
  const parsed = SummaryTextSchema.safeParse(response.parsed_output);

  if (!parsed.success) {
    return { section: null, failure: 'unparsable', detail: parsed.error.message, usage };
  }

  const noteByOrdinal = new Map(parsed.data.articleNotes.map((n) => [n.ordinal, n.text.trim()]));
  const noteByCategory = new Map(
    parsed.data.categoryNotes.map((n) => [n.category, n.note.trim()]),
  );

  // 설명이 하나도 붙지 않았으면 요약이 아니다
  if (noteByOrdinal.size === 0) {
    return { section: null, failure: 'no-article-notes', detail: '설명 0건', usage };
  }

  const byCategory = new Map<Category, typeof numbered>();
  for (const article of numbered) {
    byCategory.set(article.category, [...(byCategory.get(article.category) ?? []), article]);
  }

  const lines: string[] = [];
  const articleIds: string[] = [];

  for (const [category, list] of byCategory) {
    lines.push(`## ${categoryLabel(category, locale)}`);

    const note = noteByCategory.get(category);
    if (note) lines.push(note);

    for (const article of list) {
      // 설명이 빠진 기사는 한 줄 요약으로 대신한다. 담아둔 기사가
      // 요약에서 통째로 사라지는 것보다 낫다
      const text = noteByOrdinal.get(article.ordinal) ?? article.oneLineSummary;
      lines.push(`- [${article.title}](${article.slug}) — ${text}`);
      articleIds.push(article.articleId);
    }
  }

  return {
    section: { intro: parsed.data.intro.trim(), body: lines.join('\n\n'), articleIds },
    failure: null,
    usage,
  };
}
