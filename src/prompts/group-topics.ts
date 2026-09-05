import { z } from 'zod';

/**
 * 그룹핑 프롬프트 (로드맵 2.2, 2.3).
 *
 * 같은 사건을 다룬 여러 피드 항목을 하나의 토픽으로 묶고,
 * 최근 발행한 기사의 후속인지 판정한다.
 *
 * 프롬프트는 영어로 쓴다. 대상 콘텐츠가 영어고, 산출되는 토픽 제목이
 * 그대로 다음 단계(채점·조사)로 넘어가기 때문이다.
 */

export const GroupedTopicSchema = z.object({
  title: z
    .string()
    .describe('One sentence naming the event, specific enough to search for later.'),
  itemNumbers: z
    .array(z.number().int())
    .describe('Candidate numbers that report this same event. At least one.'),
  followUpOf: z
    .union([z.number().int(), z.null()])
    .describe(
      'Number of the recently published article this continues, or null if this is a new story.',
    ),
});

export const GroupingResultSchema = z.object({
  topics: z.array(GroupedTopicSchema),
});

export type GroupedTopic = z.infer<typeof GroupedTopicSchema>;
export type GroupingResult = z.infer<typeof GroupingResultSchema>;

export const GROUPING_SYSTEM = `You group news feed items into topics for a science and technology publication.

A topic is one real-world event or finding. Several outlets often cover the same event with different headlines — those belong to one topic.

Rules:
- Group items only when they report the SAME event, not merely the same subject area. Two unrelated battery studies are two topics.
- Every candidate number must appear in exactly one topic. Do not drop any.
- Write each topic title as a specific, searchable sentence. "New battery chemistry doubles cycle life" — not "Battery news".
- Mark a topic as a follow-up only when it continues a specific listed published article. A new development in the same field is not a follow-up.
- When unsure whether two items are the same event, keep them separate. Merging distinct events loses a story; splitting one costs only a little scoring budget.`;

export interface GroupingInput {
  /** 후보 항목. 번호는 1부터 */
  candidates: { title: string; description: string }[];
  /** 최근 발행한 기사 제목. 번호는 1부터 */
  recentTitles: string[];
}

/** 설명은 잘라서 넣는다. 토큰 대부분이 여기서 나간다 */
const MAX_DESCRIPTION_CHARS = 300;

export function buildGroupingPrompt(input: GroupingInput): string {
  const candidates = input.candidates
    .map((c, i) => {
      const description = c.description.slice(0, MAX_DESCRIPTION_CHARS);
      return `${i + 1}. ${c.title}\n   ${description}`;
    })
    .join('\n');

  const recent =
    input.recentTitles.length > 0
      ? input.recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(none)';

  return `Recently published articles (for follow-up detection):
${recent}

Candidate feed items:
${candidates}

Group the candidates into topics.`;
}
