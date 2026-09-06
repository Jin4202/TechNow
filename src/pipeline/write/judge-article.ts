import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { readUsage, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { models } from '@/config/models';
import {
  ArticleJudgementSchema,
  buildJudgePrompt,
  JUDGE_SYSTEM,
  type ArticleJudgement,
} from '@/prompts/judge-article';

import type { WrittenArticle } from './write-article';

/**
 * 루브릭 판정 (평가 프레임워크).
 *
 * **개발 단계 전용.** 파이프라인에 넣지 않는다. 프롬프트를 고쳤을 때 나아졌는지
 * 판단할 근거를 만드는 것이 목적이다.
 *
 * 계산 지표는 형식을 재지만 "설명이 통하는가"는 재지 못한다. 그 부분을 맡는다.
 *
 * **판정 모델은 Sonnet 이다** (D-47). Haiku 로 Sonnet 의 글을 심사하면 계기가
 * 잡음원이 된다 — 이 점수로 프롬프트 채택을 결정하므로 계기를 먼저 맞춘다.
 */

export interface JudgeResult {
  judgement: ArticleJudgement | null;
  error: string | null;
  usage: TokenUsage;
}

export async function judgeArticle(
  claude: AnthropicClient,
  article: WrittenArticle,
): Promise<JudgeResult> {
  try {
    const response = await claude.messages.parse({
      model: models.judge, // Sonnet. 개발 전용이라 파이프라인 비용과 무관하다 (D-47)
      max_tokens: 4000,
      system: JUDGE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildJudgePrompt({
            title: article.title,
            oneLineSummary: article.oneLineSummary,
            sections: article.sections,
          }),
        },
      ],
      output_config: { format: zodOutputFormat(ArticleJudgementSchema) },
    });

    const judgement = response.parsed_output;
    if (!judgement) {
      return { judgement: null, error: '판정 결과를 파싱하지 못함', usage: readUsage(response.usage) };
    }

    return { judgement, error: null, usage: readUsage(response.usage) };
  } catch (error) {
    return {
      judgement: null,
      error: error instanceof Error ? error.message : String(error),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    };
  }
}

/** 다섯 축의 평균. 리포트 정렬용이며, 이 숫자만 보고 판단하지 않는다 */
export function overallScore(judgement: ArticleJudgement): number {
  const axes = [
    judgement.comprehensibility.score,
    judgement.termHandling.score,
    judgement.concreteness.score,
    judgement.structure.score,
    judgement.tone.score,
  ];
  return axes.reduce((sum, n) => sum + n, 0) / axes.length;
}

export const AXIS_LABELS: Record<string, string> = {
  comprehensibility: '이해 가능성',
  termHandling: '용어 처리',
  concreteness: '구체성',
  structure: '구조',
  tone: '어조',
};
