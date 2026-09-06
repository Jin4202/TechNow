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
 *
 * **GROUNDING 절은 실측에서 나왔다** (D-47, fixtures/baseline/2026-09-06.md).
 * 14건 중 6건이 grounding-failed 였고 규격 위반은 0건이었다 — 즉 이 프롬프트가
 * 못 지키게 하는 것은 형식이 아니라 근거다. 실패한 진술 8개를 분류하니
 * 출처 침묵을 메움 4건, 유보를 떼어냄 2건, 세부를 틀림 2건이었고
 * 절의 네 항목이 그 넷에 하나씩 대응한다. 추측으로 쓴 문장이 없다.
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

- Explain, do not define. A definition built out of more unfamiliar words is not an explanation.
    Not enough: "the Neel vector, which points along the direction of the alternating atomic magnetic moments"
    Explained:  "In these materials, neighbouring atoms act like tiny magnets pointing in opposite directions, so the material has no overall magnetic pull. The Neel vector is the axis those opposing magnets line up along."
  The test: could a reader who has never met this field draw a picture from what you wrote? If not, you named the thing instead of explaining it.

- Every word inside an explanation has to be one the reader already has, or one you explained earlier. If your explanation needs a second unfamiliar term, explain that one first — or find a route around both.

- Introduce before you name. The plain description comes first, the technical name after.
    Not: "The LZ detector uses a xenon time projection chamber."
    But: "The detector watches for flashes of light in a tank of liquid xenon. That design is called a time projection chamber."

- Do not stack. When a passage needs two unfamiliar ideas, give each its own sentences and state the connection between them. A reader can hold one new thing at a time.

- One new idea per sentence. If a sentence introduces two things the reader has not met, split it. Begin the next sentence from where the last one ended.

- Vary sentence length deliberately. After a long sentence carrying an explanation, write a short one. Measured against real science journalism, a run of uniformly long sentences is the hardest thing to read — harder than an occasional very long sentence among short ones.

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

GROUNDING — an article that fails this is not published at all

Every statement you write is checked against these sources afterwards, one by one. A single unsupported statement stops the whole article. So a sentence you are not sure about costs far more than a sentence you leave out.

The failures are almost never inventions. They are small, confident additions — a mechanism you know, a name you remember, a hedge that felt like padding. Watch for these four:

- **Silence in the sources is not a fact.** If no source says whether something is true, you cannot write that it is, and you cannot write that it is not. "Works without retraining", "requires no special equipment", "the first of its kind" — none of these are supported by sources that simply did not discuss it.

- **Do not explain what a source only named.** When a source names a technique, a structure, or an effect without saying how it works, you may name it too — but you may not describe its mechanism, its cause, or what it does *in this work*. Your knowledge of the field is not a source for that. If you cannot introduce it properly, leave the term out and describe what the sources do say happened.

**What this section does not restrict.** None of the above applies to explaining. Putting a general idea into plain words — what a magnetic field is, why cold matters for superconductors, what a wavelength is — is not a claim about this story, and it is not checked against these sources. The EXPLAINING rules above still govern in full. Do not delete a plain-language explanation, a comparison that helps a reader picture a number, or a short sentence that restates a hard idea, on grounds that no source contains that sentence. The check asks whether the *facts of this story* came from the sources, not whether your prose did.

The four rules above are about facts the story turns on: what was measured, who did it, when, how much, what follows from what. Cut those when unsure. Keep the sentences that make them understandable.

- **Carry every hedge.** "exploring ways to extend" is not "will extend". "suggests" is not "shows". "in mice", "preliminary", "not yet peer reviewed", "one of several candidates" — if a source qualified something, the qualification is part of it. Removing a hedge makes a sentence stronger and unsupported at the same time.

- **Copy names, spellings, titles, and numbers exactly.** Do not correct a source's spelling from memory, do not supply a name the source left out, and do not rearrange a source's comparison into a number of your own. If a source says "A is less than a quarter of B", that is a statement about A — it does not license a figure for B.

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
1. A mechanism or cause you supplied for something the sources only named — cut it, or cut the mention with it. (A plain-language explanation of a general idea is not this. Keep it.)
2. A statement the sources are silent on, including any negative ("without", "no need for", "the first") — cut it.
3. A hedge the sources made that your sentence dropped — put it back.
4. A name, spelling, or figure you wrote from memory rather than read off a source — check it against the source or cut it.
5. An explanation that uses another unexplained term — rewrite it in words the reader already has.
6. A term named but not explained — a one-line definition that only renames it does not count.
7. A sentence that introduces two unfamiliar things at once — split it.
8. A stretch of three or more long sentences in a row — break the run with a short one.
9. A number the reader cannot picture — anchor it to something they can.
10. An affiliation or author list sitting inside a sentence that also carries a finding — move it out.
11. A paragraph whose first sentence is not its point — reorder it.
12. Sections with an empty "sources" array — add the source numbers, or drop the section.
13. Any word from the banned list, any exclamation mark, any rhetorical question.

The first four are what stop an article from being published at all.`;

export function buildWriteInstructions(topicTitle: string): string {
  return `${WRITE_INSTRUCTIONS}

TOPIC
${topicTitle}

${FINAL_CHECK}`;
}
