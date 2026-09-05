import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { readUsage, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { EFFORT, models } from '@/config/models';
import { isCategory, type Category } from '@/config/categories';
import {
  buildGroundedMessages,
  buildSourceBlock,
  GROUNDED_SYSTEM,
  type PromptSource,
} from '@/prompts/grounded-steps';
import { buildWriteInstructions, DraftArticleSchema } from '@/prompts/write-article';

/**
 * 기사 작성 (로드맵 3.6).
 *
 * 출처 본문을 읽는 네 단계 중 첫 번째. 캐시 프리픽스를 만드는 쪽이라
 * 여기서 cache_creation 토큰이 나가고, 이후 단계들이 그것을 읽는다 (D-06).
 */

export interface ArticleSection {
  heading: string;
  paragraphs: string[];
  /** article_sources.ordinal 참조 */
  sources: number[];
}

export interface WrittenArticle {
  title: string;
  oneLineSummary: string;
  category: Category;
  tags: string[];
  sections: ArticleSection[];
}

export type WriteFailure =
  /** 구조화 출력이 파싱되지 않음 */
  | 'unparsable'
  /** 섹션 수가 규격을 벗어남 */
  | 'bad-section-count'
  /** 근거 없는 섹션이 있음 */
  | 'section-without-sources'
  /** 존재하지 않는 출처 번호를 가리킴 */
  | 'unknown-source-ordinal'
  /** 카테고리가 7종 밖 */
  | 'bad-category';

export interface WriteResult {
  article: WrittenArticle | null;
  failure: WriteFailure | null;
  detail?: string;
  usage: TokenUsage;
}

const MIN_SECTIONS = 3;
const MAX_SECTIONS = 5;

/**
 * 모델 출력을 검증한다 (3.6a).
 *
 * DB check 제약과 D-03 의 구조 규칙을 코드에서 먼저 잡는다 —
 * 여기서 통과시키면 삽입 단계에서 런이 죽는다.
 */
export function validateDraft(
  draft: unknown,
  validOrdinals: readonly number[],
): { article: WrittenArticle } | { failure: WriteFailure; detail: string } {
  const parsed = DraftArticleSchema.safeParse(draft);
  if (!parsed.success) return { failure: 'unparsable', detail: parsed.error.message };

  const value = parsed.data;

  if (!isCategory(value.category)) {
    return { failure: 'bad-category', detail: value.category };
  }

  if (value.sections.length < MIN_SECTIONS || value.sections.length > MAX_SECTIONS) {
    return { failure: 'bad-section-count', detail: `${value.sections.length}개` };
  }

  const known = new Set(validOrdinals);
  for (const [index, section] of value.sections.entries()) {
    if (section.sources.length === 0) {
      return { failure: 'section-without-sources', detail: `섹션 ${index + 1}` };
    }
    const unknown = section.sources.filter((ordinal) => !known.has(ordinal));
    if (unknown.length > 0) {
      return {
        failure: 'unknown-source-ordinal',
        detail: `섹션 ${index + 1}: ${unknown.join(', ')}`,
      };
    }
  }

  return {
    article: {
      title: value.title.trim(),
      oneLineSummary: value.one_line_summary.trim(),
      category: value.category,
      tags: value.tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      sections: value.sections.map((s) => ({
        heading: s.heading.trim(),
        paragraphs: s.paragraphs.map((p) => p.trim()).filter(Boolean),
        // 중복 참조를 정리하고 순서를 고정한다
        sources: [...new Set(s.sources)].sort((a, b) => a - b),
      })),
    },
  };
}

export async function writeArticle(
  claude: AnthropicClient,
  topicTitle: string,
  sources: readonly PromptSource[],
  /** 재작성일 때 붙일 실패 사유 (3.9) */
  retryNote?: string,
): Promise<WriteResult> {
  const instructions = retryNote
    ? `${buildWriteInstructions(topicTitle)}\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED\n${retryNote}\nFix exactly these problems. Keep everything else that was already correct.`
    : buildWriteInstructions(topicTitle);

  const response = await claude.messages.parse({
    model: retryNote ? models.rewrite : models.write,
    max_tokens: 8000,
    system: GROUNDED_SYSTEM,
    messages: buildGroundedMessages(buildSourceBlock(sources), instructions),
    output_config: {
      format: zodOutputFormat(DraftArticleSchema),
      effort: retryNote ? EFFORT.rewrite : EFFORT.write,
    },
  });

  const usage = readUsage(response.usage);
  const validated = validateDraft(response.parsed_output, sources.map((s) => s.ordinal));

  if ('failure' in validated) {
    return { article: null, failure: validated.failure, detail: validated.detail, usage };
  }
  return { article: validated.article, failure: null, usage };
}

/** 기사 본문을 한 덩어리로 */
export function articleText(article: WrittenArticle): string {
  return article.sections.flatMap((s) => s.paragraphs).join(' ');
}

/** 단어 수. 스타일 가이드의 600~900 확인용 */
export function wordCount(article: WrittenArticle): number {
  return articleText(article).split(/\s+/).filter(Boolean).length;
}

export interface SentenceStats {
  count: number;
  averageWords: number;
  longest: number;
  /** 40단어를 넘는 문장. 스타일 가이드가 금지한다 */
  overLimit: string[];
}

/**
 * 문장 길이 통계.
 *
 * 개별 문장의 상한보다 평균이 중요하다 — 기관명·인명이 들어가면 30단어를
 * 넘는 일이 흔하고, 억지로 쪼개면 오히려 읽기 나빠진다 (docs/STYLE_GUIDE.md).
 */
export function sentenceStats(article: WrittenArticle): SentenceStats {
  const sentences = articleText(article)
    .split(/(?<=[.?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lengths = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
  const total = lengths.reduce((sum, n) => sum + n, 0);

  return {
    count: sentences.length,
    averageWords: sentences.length === 0 ? 0 : total / sentences.length,
    longest: lengths.length === 0 ? 0 : Math.max(...lengths),
    overLimit: sentences.filter((_, i) => lengths[i]! > 40),
  };
}
