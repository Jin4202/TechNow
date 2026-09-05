import { z } from 'zod';

import { CATEGORIES } from '@/config/categories';

/**
 * 기사 작성 프롬프트 (로드맵 3.6).
 *
 * 기준의 원본은 docs/STYLE_GUIDE.md 다. 여기 없는 규칙을 프롬프트에만 넣지 않는다.
 *
 * 출처 블록은 buildGroundedMessages 가 앞에 붙인다 (D-06). 이 파일은
 * **지시문만** 만든다 — 출처를 여기서 다시 넣으면 캐시 구조가 깨진다.
 */

const categoryValues = CATEGORIES.map((c) => c.value) as [string, ...string[]];

export const ArticleSectionSchema = z.object({
  heading: z.string().describe('Short. Names what this section covers.'),
  paragraphs: z
    .array(z.string())
    .describe('1 to 3 paragraphs, 3 to 5 sentences each.'),
  sources: z
    .array(z.number().int())
    .describe('Source numbers that support this section. Never empty.'),
});

export const DraftArticleSchema = z.object({
  title: z.string().describe('One line. Says what happened.'),
  one_line_summary: z.string().describe('One sentence. Says why it matters. Not a restatement of the title.'),
  category: z.enum(categoryValues),
  tags: z.array(z.string()).describe('2 to 5 lowercase tags. Specific nouns, not categories.'),
  sections: z.array(ArticleSectionSchema).describe('3 to 5 sections.'),
});

export type DraftArticle = z.infer<typeof DraftArticleSchema>;

const CATEGORY_LIST = CATEGORIES.map((c) => `  ${c.value} — ${c.description}`).join('\n');

/**
 * 작성 지시문.
 *
 * 출처 블록 뒤에 온다. 앞에 두면 캐시 프리픽스가 깨진다 (D-06).
 */
export const WRITE_INSTRUCTIONS = `Write the article.

STRUCTURE
- 3 to 5 sections. Two is a summary, six loses the reader.
- Each section: 1 to 3 paragraphs, 3 to 5 sentences per paragraph.
- 600 to 900 words total.
- Every section's "sources" array must be non-empty. A section with no source is a section you should not write.

A workable order, not a required one:
  1. What happened — the announcement or finding, most specific facts first
  2. How it works — the method or mechanism; this is where explanation is needed
  3. What changes — consequences, only as far as the sources go
  4. What's left — limits, unverified parts, next steps

TITLE AND SUMMARY
- The title says what happened. It does not tease.
  Good: "Fruit fly brain fully mapped for the second time"
  Bad: "Scientists just did something remarkable with a fly"
  Bad: "Connectome completion in Drosophila melanogaster"
- Put the number in the title when the number is the point.
- The summary says why it matters. It is not the title again.

SENTENCES — this is the rule most often broken, so check it
- One piece of information per sentence. If a sentence contains two facts joined by a comma or "and", it is two sentences.
- Target average: 20 words. Your draft will be measured; an average above 24 fails.
- Nothing over 40 words.
- Attributions and affiliations are what push sentences past the limit. Split them off:

  Too long (41 words):
    "Researchers led by Greg Jefferis's group at the MRC Laboratory of Molecular Biology, working with HHMI's Janelia Research Campus and Google Research, published the connectome of a male fruit fly, the second complete fly brain to be mapped."

  Fixed (12 + 16 words):
    "A team at the MRC Laboratory of Molecular Biology published the male fly connectome. Janelia Research Campus and Google Research contributed to the reconstruction, the second complete fly brain mapped."

  The second version says the same things. It just stops between them.
- Active voice unless the actor does not matter.
- Concrete numbers, not "significantly improved".
- The first sentence of a paragraph is its point; the rest support it.

TERMS
- Explain a technical term the first time, in about a parenthesis worth:
  "a connectome (a complete wiring diagram of a brain)"
- Avoid the term where you can, but never at the cost of accuracy. A reader should be able to find the paper from your article.

TONE
Explaining, not selling and not sneering. Do not use: revolutionary, groundbreaking, game-changing, stunning, incredible. No exclamation marks. No rhetorical questions. No addressing the reader.
When a result is impressive, show the number instead of the adjective:
  Not "the improvement is remarkable"
  But "previous coatings lasted about 800 cycles; this one lasted 4,000"

ATTRIBUTION
Attribute in the text only when it matters: a claim only one source makes, a figure the sources disagree on, or a direct characterisation by the researchers. Do not narrate your reading ("Ars Technica describes...", "The MRC LMB reports..."), which turns the article into a report about coverage rather than about the science. The source numbers already record where each section came from.

TRANSLATION
This article will be translated into Korean with its structure preserved. Avoid wordplay, alliteration, English idioms ("a shot in the arm"), and metaphors that rely on American culture. Metaphors that rely on physical things travel fine.

CATEGORY
Pick exactly one:
${CATEGORY_LIST}

TAGS
2 to 5 lowercase tags. Specific nouns from the story — an organisation, an instrument, a material, an organism. Not the category name again.`;

/**
 * 반환 직전 자가 점검.
 *
 * 지시만으로는 문장 길이가 지켜지지 않았다 (실측 평균 38 → 예시 추가 후 27.7).
 * 체크리스트를 마지막에 두면 모델이 초안을 실제로 다시 훑는다.
 */
const FINAL_CHECK = `BEFORE YOU RETURN
Read your draft back once and fix these, in this order:
1. Any sentence over 40 words — split it.
2. Sentences that pack an affiliation or a list into the main clause — move that to its own sentence.
3. Sections with an empty "sources" array — add the source numbers, or drop the section.
4. Any word from the banned list, any exclamation mark, any rhetorical question.
5. A summary that only restates the title — rewrite it to say why the result matters.

Most drafts fail on the first two. Expect to split three or four sentences.`;

export function buildWriteInstructions(topicTitle: string): string {
  return `${WRITE_INSTRUCTIONS}

TOPIC
${topicTitle}

${FINAL_CHECK}`;
}
