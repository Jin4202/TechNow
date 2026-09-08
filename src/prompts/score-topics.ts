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

/**
 * 토픽의 종류 (D-57).
 *
 * **점수가 아니라 구성을 위한 것이다.** 선정 단계가 "하루 N건 중 단일 논문은
 * 최대 M건" 같은 쿼터를 걸 수 있게 한다 — 점수를 주무르는 대신 카운터로 막는다
 * (CLAUDE.md §2.6 과 같은 결).
 *
 * 왜 필요했나: 후보 풀의 66% 가 논문 보도자료 재게시처(ScienceDaily, phys.org)
 * 인데 임계 통과에서는 81% 로 오히려 쏠렸다. novelty 앵커가
 * "A paper ... made public today" 를 5점으로 정의하므로 채점이 논문을 선호한다.
 * 점수 조정으로 두 번 시도했다가 두 번 다 실패했다 (D-56, D-57).
 */
export const TopicKindSchema = z
  .enum(['paper', 'event', 'product', 'trend'])
  .describe('What kind of topic this is.');

export type TopicKind = z.infer<typeof TopicKindSchema>;

export const TopicScoreSchema = z.object({
  topicNumber: z.number().int().describe('The topic number from the input list.'),
  kind: TopicKindSchema,
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

First classify each topic, then score it on three axes, 1 to 5, with a one-line reason for each. The reason must answer "why this score and not one higher".

KIND — what sort of thing is this?
paper    A single study, preprint, or research finding. "Researchers found that X."
         A press release about one paper is still a paper.
event    Something happened in the world. A launch, an outage, a ruling, an acquisition,
         an outbreak, a policy decision, a disaster.
product  Something was released or announced that people can use or buy.
trend    A pattern across many cases: a survey, an industry shift, an analysis of
         several studies, a change in how a field works.

Classify by what the topic IS, not by who published it. A newspaper writing about
one study is still "paper"; a journal announcing it is shutting down is "event".
This does not affect the scores — score the topic on its merits either way.

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

/**
 * 근접 재채점 프롬프트 (로드맵 2.5).
 *
 * 1차 채점은 RSS 설명만 봤다. 임계선 근처 토픽은 원문을 가져와 다시 본다.
 * 시스템 프롬프트(기준)는 1차와 같은 것을 쓴다 — 기준이 달라지면 두 점수를
 * 비교할 수 없다.
 */

/** 본문을 통째로 넣지 않는다. 앞부분에 핵심이 있고, 뒤로 갈수록 부록이다 */
const MAX_ARTICLE_CHARS = 6000;

export interface RescoreTopicInput {
  title: string;
  /** 1차 채점 결과. 무엇이 달라졌는지 모델이 알 수 있게 넣는다 */
  firstPass: { novelty: number; impact: number; interest: number };
  articleTitle: string | null;
  articleText: string;
  followUpOfTitle?: string | null;
}

export function buildRescorePrompt(topic: RescoreTopicInput): string {
  const lines = [
    `Topic 1: ${topic.title}`,
    '',
    'You scored this topic from the feed summary alone as ' +
      `novelty ${topic.firstPass.novelty}, impact ${topic.firstPass.impact}, ` +
      `interest ${topic.firstPass.interest}. Below is the full source article. ` +
      'Score it again from the article. Change a score only if the article shows the ' +
      'first pass was wrong; agreeing with yourself is a valid outcome.',
  ];

  if (topic.followUpOfTitle) {
    lines.push('', `Follow-up to our published article: "${topic.followUpOfTitle}"`);
  }

  lines.push('', '--- SOURCE ARTICLE ---');
  if (topic.articleTitle) lines.push(topic.articleTitle);
  lines.push(topic.articleText.slice(0, MAX_ARTICLE_CHARS).trim());
  lines.push('--- END ---');

  return lines.join('\n');
}
