import { z } from 'zod';

/**
 * 1차 중요도 채점 프롬프트 (로드맵 2.4).
 *
 * 기준의 원본은 docs/RUBRIC.md 다. 여기 없는 기준을 프롬프트에만 넣지 않는다.
 * 루브릭을 고치면 이 파일도 같이 고친다.
 */

const AxisSchema = z.object({
  score: z.number().int().describe('1 to 5.'),
  reason: z.string().describe('One line. Must answer why this score and not one higher.'),
});

export const TopicScoreSchema = z.object({
  topicNumber: z.number().int().describe('The topic number from the input list.'),
  novelty: AxisSchema,
  impact: AxisSchema,
  interest: AxisSchema,
});

export const ScoringResultSchema = z.object({
  scores: z.array(TopicScoreSchema),
});

export type TopicScore = z.infer<typeof TopicScoreSchema>;
export type ScoringResult = z.infer<typeof ScoringResultSchema>;

/**
 * 시스템 프롬프트. docs/RUBRIC.md 의 앵커를 그대로 옮긴 것이다.
 *
 * 청크마다 동일하므로 프롬프트 캐시의 프리픽스가 된다.
 */
export const SCORING_SYSTEM = `You score candidate topics for a science and technology publication that publishes at most three articles a day.

Score each topic on three axes, 1 to 5, and give a one-line reason for each. The reason must answer "why this score and not one higher".

NOVELTY — is this new information, or a repeat of what is already known?
5  First announcement. A paper or institutional release made public today.
4  A meaningful advance along a known direction. A number or method actually changed.
3  New, but within the expected range. A scheduled launch succeeded.
2  Repackaging of existing material with no new data. A "how AI is changing medicine" roundup.
1  A repeat of something already covered, or a rumour.

For a follow-up, judge novelty against the article we already published: a minor update scores low, a reversal or a change in scale scores high.

IMPACT — how many people or fields change, and how soon?
5  Several fields, or hundreds of millions of people. Already underway or within one to two years.
4  A whole field, or tens of millions of people, within several years.
3  A specific industry or region, and it will take time.
2  A narrow specialist area only.
1  No practical consequence beyond academic interest.

"Could matter someday" is not impact. Most basic research sits at 2 or 3, and that is correct — such topics should pass on novelty and interest instead. Market size and funding amounts are weak evidence of impact: money moving is not the same as something changing.

READER INTEREST — will a curious non-specialist click and finish it?
5  Immediately compelling without explanation.
4  Interesting once you read one sentence of context.
3  Needs background, but is interesting once explained.
2  Interesting only to specialists.
1  No reason for a general reader to read it.

This measures "worth finishing", not "drives clicks". A trivial result dressed in dramatic language scores low.

RULES
- When the feed description is too thin to judge, score low rather than guessing high. Near-threshold topics get their source page fetched and rescored later; an unwarranted high score wastes that budget.
- The number of outlets covering a topic is not evidence of impact. Outlets follow each other.
- Category balance is irrelevant. Do not adjust scores to spread topics across fields.
- Preprints: score novelty normally, but drop impact one level — the work is not yet reviewed.
- Company announcements without third-party verification: do not give impact above 3.
- Obituaries and awards: usually impact 1 or 2.
- Product releases: novelty 2 if only specifications improved; 3 or higher if the approach changed.

Return one entry per topic, using the topic numbers given.`;

export interface ScoringTopicInput {
  title: string;
  /** 이 토픽을 구성하는 피드 항목들 */
  items: { title: string; description: string }[];
  /** 후속인 경우 원본 기사 제목 */
  followUpOfTitle?: string | null;
}

const MAX_DESCRIPTION_CHARS = 400;

export function buildScoringPrompt(topics: readonly ScoringTopicInput[]): string {
  return topics
    .map((topic, index) => {
      const lines = [`Topic ${index + 1}: ${topic.title}`];

      if (topic.followUpOfTitle) {
        lines.push(`  Follow-up to our published article: "${topic.followUpOfTitle}"`);
      }

      for (const item of topic.items) {
        lines.push(`  - ${item.title}`);
        const description = item.description.slice(0, MAX_DESCRIPTION_CHARS).trim();
        if (description) lines.push(`    ${description}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}
