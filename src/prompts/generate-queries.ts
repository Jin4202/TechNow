import { z } from 'zod';

/**
 * 검색 쿼리 생성 프롬프트 (로드맵 3.5).
 *
 * 목표는 **1차 출처를 찾는 것**이지 관련 기사를 더 찾는 것이 아니다.
 * 뉴스 재탕을 모으면 출처 수만 늘고 근거는 늘지 않는다.
 */

export const QueryPlanSchema = z.object({
  queries: z
    .array(z.string())
    .describe('2 to 3 search queries, ordered from most to least likely to find a primary source.'),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;

export const QUERY_SYSTEM = `You write web search queries that find PRIMARY sources for a news topic.

A primary source is the paper, preprint, official announcement, institutional press release, or agency publication that the news is about. News coverage of it is not a primary source.

Write 2 to 3 queries, ordered from most to least likely to reach a primary source:
1. The specific event plus the organisation that announced it. Use the proper names.
2. The likely title or subject of the paper or announcement, in the words a researcher would use.
3. Optional: a distinctive number, instrument, or method name from the topic.

Rules:
- Use the specific proper nouns from the topic — organisation, mission, instrument, gene, material. Generic queries return news roundups.
- No search operators (no site:, quotes, AND/OR). They narrow results in ways that hurt more than help here.
- No date words like "2026" or "latest" unless the date is part of the event's name.
- Each query stands alone. Do not write a query that only makes sense after the previous one.
- Keep each query under 12 words.`;

export interface QueryPromptInput {
  topicTitle: string;
  items: { title: string; description: string }[];
}

const MAX_DESCRIPTION_CHARS = 400;

export function buildQueryPrompt(input: QueryPromptInput): string {
  const lines = [`Topic: ${input.topicTitle}`, '', 'Feed items that reported it:'];

  for (const item of input.items) {
    lines.push(`- ${item.title}`);
    const description = item.description.slice(0, MAX_DESCRIPTION_CHARS).trim();
    if (description) lines.push(`  ${description}`);
  }

  lines.push('', 'Write the search queries.');
  return lines.join('\n');
}
