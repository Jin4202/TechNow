import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { readUsage, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { EFFORT, models } from '@/config/models';
import {
  buildArticleBrief,
  CONCEPT_INSTRUCTIONS,
  CONCEPT_SYSTEM,
  CoverConceptSchema,
  type CoverConcept,
} from '@/prompts/cover-concept';

/**
 * 커버에 무엇을 그릴지 정한다 (로드맵 5.2, D-38).
 *
 * 기사를 읽는 쪽이 장면을 고르고, 이미지 모델은 렌더링만 한다.
 * 출처 본문을 읽지 않으므로 D-06 의 캐시 프리픽스와 무관하다.
 */

export interface ArticleBrief {
  title: string;
  oneLineSummary: string;
  sections: readonly { heading: string; paragraphs: string[] }[];
}

export type ConceptFailure =
  /** 구조화 출력이 스키마에 맞지 않음 */
  | 'unparsable'
  /** 장면 설명이 비었거나 그릴 수 없음 */
  | 'empty-scene';

export interface ConceptResult {
  concept: CoverConcept | null;
  failure: ConceptFailure | null;
  detail?: string;
  usage: TokenUsage;
}

/** 장면 설명이 이보다 짧으면 그릴 것이 없다 */
const MIN_SCENE_CHARS = 20;

export async function chooseCoverConcept(
  claude: AnthropicClient,
  article: ArticleBrief,
): Promise<ConceptResult> {
  const response = await claude.messages.parse({
    model: models.coverConcept,
    max_tokens: 1000,
    system: CONCEPT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${buildArticleBrief(article)}\n\n${CONCEPT_INSTRUCTIONS}`,
      },
    ],
    output_config: {
      format: zodOutputFormat(CoverConceptSchema),
      effort: EFFORT.coverConcept,
    },
  });

  const usage = readUsage(response.usage);
  const parsed = CoverConceptSchema.safeParse(response.parsed_output);

  if (!parsed.success) {
    return { concept: null, failure: 'unparsable', detail: parsed.error.message, usage };
  }

  const scene = parsed.data.scene.trim();
  if (scene.length < MIN_SCENE_CHARS) {
    return { concept: null, failure: 'empty-scene', detail: scene, usage };
  }

  return {
    concept: { ...parsed.data, scene, rationale: parsed.data.rationale.trim() },
    failure: null,
    usage,
  };
}
