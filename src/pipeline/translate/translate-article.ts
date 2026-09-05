import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { readUsage, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { EFFORT, models } from '@/config/models';
import {
  KoreanArticleSchema,
  TRANSLATE_INSTRUCTIONS,
  TRANSLATE_SYSTEM,
} from '@/prompts/translate-article';

import { checkParity, type ParityFailure } from './check-parity';

import type { ArticleSection } from '@/pipeline/write/write-article';

/**
 * 영문 기사 → 한국어 (로드맵 4.3).
 *
 * Sonnet 이다 (CLAUDE.md §2.7). 출처 본문을 읽지 않으므로 D-06 의 캐시와 무관하고,
 * 모델을 바꿔도 캐시가 깨지지 않는다 — 다만 번역 품질이 곧 한국어 독자가 보는
 * 전부라 싼 쪽으로 내리지 않는다.
 *
 * 구조 검증(4.3a)을 여기서 함께 한다. 검증을 통과하지 못한 번역은 돌려주지 않는다 —
 * 부르는 쪽이 실수로 저장할 수 있는 자리를 만들지 않는다.
 */

export interface EnglishArticle {
  title: string;
  oneLineSummary: string;
  sections: readonly ArticleSection[];
}

export interface TranslatedArticle {
  title: string;
  oneLineSummary: string;
  sections: ArticleSection[];
}

export type TranslateFailure =
  /** 구조화 출력이 스키마에 맞지 않음 */
  | 'unparsable'
  /** 원문과 구조가 다름 (4.3a) */
  | ParityFailure;

export interface TranslateResult {
  translation: TranslatedArticle | null;
  failure: TranslateFailure | null;
  detail?: string;
  usage: TokenUsage;
}

/** 번역할 기사를 프롬프트에 싣는 형식. 구조가 눈에 보여야 모델이 그것을 지킨다 */
export function buildArticleBlock(article: EnglishArticle): string {
  const sections = article.sections
    .map(
      (section, index) =>
        [
          `## Section ${index + 1}`,
          `heading: ${section.heading}`,
          `sources: [${section.sources.join(', ')}]`,
          ...section.paragraphs.map((paragraph, i) => `paragraph ${i + 1}: ${paragraph}`),
        ].join('\n'),
    )
    .join('\n\n');

  return `# Article\ntitle: ${article.title}\nsummary: ${article.oneLineSummary}\n\n${sections}`;
}

export async function translateArticle(
  claude: AnthropicClient,
  article: EnglishArticle,
  /** 재시도일 때 붙일 실패 사유 (4.4 의 런 내 1회 재시도) */
  retryNote?: string,
): Promise<TranslateResult> {
  const instructions = retryNote
    ? `${TRANSLATE_INSTRUCTIONS}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED\n${retryNote}\nFix exactly that. Keep the rest of the translation as it was.`
    : TRANSLATE_INSTRUCTIONS;

  const response = await claude.messages.parse({
    model: models.translate,
    max_tokens: 8000,
    system: TRANSLATE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${buildArticleBlock(article)}\n\n${instructions}`,
      },
    ],
    output_config: {
      format: zodOutputFormat(KoreanArticleSchema),
      effort: EFFORT.translate,
    },
  });

  const usage = readUsage(response.usage);

  const parsed = KoreanArticleSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    return { translation: null, failure: 'unparsable', detail: parsed.error.message, usage };
  }

  const translation: TranslatedArticle = {
    title: parsed.data.title.trim(),
    oneLineSummary: parsed.data.one_line_summary.trim(),
    sections: parsed.data.sections.map((section) => ({
      heading: section.heading.trim(),
      paragraphs: section.paragraphs.map((p) => p.trim()).filter(Boolean),
      sources: section.sources,
    })),
  };

  const parity = checkParity(article, translation);
  if (parity) {
    return { translation: null, failure: parity.failure, detail: parity.detail, usage };
  }

  return { translation, failure: null, usage };
}
