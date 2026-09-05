import { z } from 'zod';

import { CATEGORIES } from '@/config/categories';

/**
 * 기사 작성 프롬프트 (로드맵 3.6).
 *
 * 기준의 원본은 docs/STYLE_GUIDE.md 다. 여기 없는 규칙을 프롬프트에만 넣지 않는다.
 *
 * **수치를 지시로 쓰지 않는다** (D-27). 모델은 생성하면서 단어를 세지 않으므로
 * "평균 20단어", "600~900단어" 같은 지시는 수행될 수 없다. 실측에서
 * 작은 정수의 구조 단위("3~5개 섹션")는 100% 지켜졌고 누적 수치는 계속 어겨졌다.
 * 목표는 이해 가능성이고, 문장 길이는 그것의 대리 지표였다.
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

const CATEGORY_LIST = CATEGORIES.map((c) => `  ${c.value} — ${c.descriptionEn}`).join('\n');

/**
 * 작성 지시문.
 *
 * 출처 블록 뒤에 온다. 앞에 두면 캐시 프리픽스가 깨진다 (D-06).
 */
export const WRITE_INSTRUCTIONS = `Write the article.

STRUCTURE
- 3 to 5 sections. Two is a summary, six loses the reader.
- Each section: 1 to 3 paragraphs, 3 to 5 sentences each.
- Aim for 600 to 900 words. Two reasons, and the second matters more: past 900 the reader stops before the end, and every extra paragraph adds claims that must each be traceable to a source. A longer article is a more fragile one.
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
- Sentence case: capitalise the first word and proper nouns only. Not Title Case.
- Under 14 words. A title with a comma splice is usually two ideas; keep the first.
- The summary says why it matters. It is not the title again.

EXPLAINING — this is what the article is for

Your reader is curious and educated but new to this field. They read once, straight through, without stopping to look anything up. Write so they never need to.

- Introduce before you use. A term, instrument, or organisation appears in plain words first, then by name.
    Not: "The LZ detector uses a xenon time projection chamber."
    But: "The detector watches for flashes of light in a tank of liquid xenon. That design is called a time projection chamber."

- One new idea per sentence. If a sentence introduces two things the reader has not met, split it. Begin the next sentence from where the last one ended.

- One statement per sentence, plus at most one explanation of a term inside it. A definition set off by commas or dashes is not a second statement — those are what make the article readable, so keep them. But when a sentence states one thing and then states another, that is two sentences.
    Fine: "The nerve cord, the part of the nervous system below the brain that carries commands to muscles, contains 45 descending neurons."
    Not fine: "The nerve cord contains 45 descending neurons, the team traced each one to its target muscle, and the pattern matched what earlier work had predicted."
    That last one is three statements. Write it as three sentences.

- Say why, not only what. When a result follows from a method, state the link.
    Not: "The team cooled the sample to 20 millikelvin and saw the transition."
    But: "Superconductivity only appears near absolute zero. The team cooled the sample to 20 millikelvin, and the transition appeared."

- Anchor numbers to something the reader can picture.
    Not: "an orbit 1.5 million kilometres from Earth"
    But: "an orbit four times farther out than the Moon"

- Keep names out of the way. An affiliation or an author list goes in its own sentence, after the finding — never inside the sentence that carries it.
    Not: "Researchers led by Greg Jefferis's group at the MRC Laboratory of Molecular Biology, working with HHMI's Janelia Research Campus and Google Research, published the connectome of a male fruit fly, the second complete fly brain to be mapped."
    But: "A team at the MRC Laboratory of Molecular Biology published the male fly connectome. It is the second complete fly brain to be mapped. Janelia Research Campus and Google Research contributed to the reconstruction."

- A paragraph makes one point. Its first sentence states the point; the rest supply the specifics.

- Read each sentence as someone who does not know the field. If you would have to stop and re-read it, split it or explain the missing piece first.

- Active voice unless the actor does not matter.
- Concrete numbers, not "significantly improved".

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
 * 항목이 전부 **구조적으로 확인 가능한 것**이다 — 세지 않아도 보면 안다 (D-27).
 * 수치 점검("평균 20단어")을 넣었을 때는 지켜지지 않았다. 모델은 생성 중에 세지 않는다.
 */
const FINAL_CHECK = `BEFORE YOU RETURN
Read your draft as someone meeting this subject for the first time. Fix, in order:
1. A term used before it was explained — move the explanation earlier.
2. A sentence that introduces two unfamiliar things at once — split it.
2b. A sentence that states two separate things — split it. Keep inline definitions; they are not statements.
3. A number the reader cannot picture — anchor it to something they can.
4. An affiliation or author list sitting inside a sentence that also carries a finding — move it out.
5. A paragraph whose first sentence is not its point — reorder it.
6. Sections with an empty "sources" array — add the source numbers, or drop the section.
7. Any word from the banned list, any exclamation mark, any rhetorical question.

Most drafts fail on the first two.`;

export function buildWriteInstructions(topicTitle: string): string {
  return `${WRITE_INSTRUCTIONS}

TOPIC
${topicTitle}

${FINAL_CHECK}`;
}
