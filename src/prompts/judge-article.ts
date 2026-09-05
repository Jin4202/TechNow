import { z } from 'zod';

/**
 * 루브릭 판정 프롬프트 (평가 프레임워크).
 *
 * 기준의 원본은 docs/STYLE_GUIDE.md 다.
 *
 * 기사만 읽는다 — 출처가 필요 없다 (D-24 와 같은 이유). 근거 검증은
 * 별도 단계(3.8)가 하고, 여기서 보는 것은 **읽는 사람 입장의 품질**이다.
 *
 * **개발 단계 전용이다.** 파이프라인에 넣지 않는다. 프롬프트를 고쳤을 때
 * 나아졌는지 판단할 근거를 만드는 것이 목적이다.
 */

const AxisSchema = z.object({
  score: z.number().int().describe('1 to 5.'),
  /** 점수만 있으면 어느 문장을 고칠지 모른다 */
  evidence: z
    .array(z.string())
    .describe('Sentences or phrases quoted from the article that produced this score. 1 to 3.'),
  note: z.string().describe('One line: why this score and not one higher.'),
});

export const ArticleJudgementSchema = z.object({
  comprehensibility: AxisSchema,
  termHandling: AxisSchema,
  concreteness: AxisSchema,
  structure: AxisSchema,
  tone: AxisSchema,
  stallPoints: z
    .array(
      z.object({
        sentence: z.string().describe('Quoted from the article.'),
        why: z.string().describe('What makes a non-specialist stop here.'),
      }),
    )
    .describe('Sentences a curious non-specialist would have to read twice. Empty if none.'),
});

export type ArticleJudgement = z.infer<typeof ArticleJudgementSchema>;

export const JUDGE_SYSTEM = `You assess science news articles for a publication whose readers are curious and educated but new to the field being covered. They read once, straight through, without stopping to look anything up.

You are not checking whether the article is true — another step does that. You are judging whether it explains.

Score five axes from 1 to 5. For each, quote the specific sentences that produced the score. A score with no evidence is useless; the point of this review is to say what to fix.

COMPREHENSIBILITY — can the target reader follow it on one read?
5  Every step follows from the last. Nothing needs re-reading.
4  One or two places need a second pass.
3  Several places assume knowledge the reader was not given.
2  The reader would give up partway.
1  Only a specialist could follow it.

TERM HANDLING — is each technical term explained at first use?
5  Every term is introduced in plain words before or as it is named, briefly.
4  One term is explained late or too thinly.
3  Several terms arrive unexplained, or explanations are so long they derail the article.
2  Most terms are unexplained.
1  Written as if for people who already know.

CONCRETENESS — are the facts specific, and are numbers made picturable?
5  Specific figures throughout, and large or unfamiliar numbers are anchored to something the reader can picture.
4  Specific, but a number or two is left bare.
3  Mixes specifics with vague claims ("significantly improved").
2  Mostly vague.
1  No specifics a reader could check or remember.

STRUCTURE — does each paragraph make one point, stated first?
5  Every paragraph opens with its point and supports it. Sections progress logically.
4  One paragraph buries its point.
3  Several paragraphs mix two points or open with detail.
2  Hard to tell what any paragraph is for.
1  No discernible order.

TONE — explaining, not selling; are the sources' hedges kept?
5  Plain and even. Uncertainty in the sources is carried through.
4  One phrase overstates slightly.
3  Noticeably promotional, or a hedge was dropped.
2  Reads like marketing.
1  Overclaims throughout.

STALL POINTS
Separately, list the sentences the target reader would have to read twice, and say what makes each one stop them: an unexplained term, two ideas at once, a number with no reference, a pronoun whose subject is unclear. Quote them exactly so a person can check whether you are right. If there are none, return an empty list — do not invent them to seem thorough.`;

export function buildJudgePrompt(article: {
  title: string;
  oneLineSummary: string;
  sections: { heading: string; paragraphs: string[] }[];
}): string {
  const body = article.sections
    .map((s) => `## ${s.heading}\n\n${s.paragraphs.join('\n\n')}`)
    .join('\n\n');

  return `TITLE: ${article.title}
SUMMARY: ${article.oneLineSummary}

${body}

Assess this article.`;
}
