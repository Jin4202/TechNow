import { z } from 'zod';

/**
 * 커버 이미지의 **장면 선택** (로드맵 5.2).
 *
 * 그림을 그리지 않는다. 무엇을 그릴지만 정한다.
 *
 * 왜 이 단계가 필요한가 (D-37): 기사 제목·요약을 이미지 모델에 그대로 넘기면,
 * 눈에 보이는 사물이 있는 기사는 잘 나오고 개념뿐인 기사는 색면으로 도망간다.
 * 이미지 모델은 기사를 읽지 않았고 비유를 고를 수 없다. 그 판단은 기사를 읽은
 * 쪽이 해야 한다.
 *
 * **개념을 그대로 그려낼 필요가 없다.** 좋은 기사 그림은 셋 중 하나다:
 *   1. 주제가 한눈에 보인다 — 가능하면 이게 최선
 *   2. 상황을 설명한다 — 사물이 아니어도 된다. 비유적인 장면
 *   3. 영향력을 보여준다 — 이 연구가 통했을 때의 일상
 */

export const CoverConceptSchema = z.object({
  mode: z
    .enum(['subject', 'scene', 'future'])
    .describe('Which of the three kinds of cover this is.'),
  scene: z
    .string()
    .describe('What to draw. One or two English sentences, concrete nouns, no proper names.'),
  rationale: z.string().describe('Why this scene fits the article. One sentence.'),
});

export type CoverConcept = z.infer<typeof CoverConceptSchema>;

export const CONCEPT_SYSTEM = `You choose what a cover illustration for a science and technology news article should show.

You do not write the article and you do not draw. You decide the picture.

The illustration is flat vector art on a dark background. It carries no text of any kind, and it never shows a face. Whatever you choose has to be drawable under those limits.`;

export const CONCEPT_INSTRUCTIONS = `Choose what the cover for this article should show.

THREE KINDS OF COVER, IN ORDER OF PREFERENCE

1. "subject" — the thing itself, seen at a glance.
   Use this whenever the article is about something a reader could look at: an instrument, an organism, a spacecraft, a device, a material.
   This is the best cover when the story allows it. A fly. A telescope. A tank of liquid held underground.

2. "scene" — a situation that describes the story indirectly.
   Use this when the subject is an effect, a measurement, or a method rather than an object.
   The comparison must rest on physical things, not on culture. A needle finding one grain in a field of grains is a scene. A trophy or a finish line is not — those are idioms, and idioms do not survive translation into a picture any better than into Korean.

3. "future" — what changes if this works.
   Use this when the result matters mainly for what it makes possible. Show the ordinary moment that this research would change: a room, a street, a hand at work, a machine in use.
   Stay inside what the article actually claims. If the article says a result is preliminary, do not draw a finished future. A cover that promises what the article does not is a false headline in picture form.

Try 1 first. Only use 2 when the story has nothing to look at, and 3 when neither works.

WHAT YOU MAY NOT CHOOSE

- **Any scene that needs text.** No signs, no screens with writing, no labelled axes, no equations, no numbers on dials. Image models cannot spell, and a cover with misspelled words on it is worse than no cover.
- **Any scene that needs a face.** People are fine as flat silhouettes, seen from behind, or cropped below the face. A portrait is not.
- **Proper names.** No company, institution, mission, product, or person by name — write what the thing is, not what it is called. "A wide-field space telescope", not the mission name.
- **Charts, diagrams, infographics, and UI.** These are illustrations, not figures.

HOW TO WRITE THE SCENE

- One or two sentences. Concrete nouns. Say what is in the frame and how it is arranged.
- Name the one thing the eye should land on first.
- Describe objects and layout, not mood. "A dark cylinder in a shaft of light, seen from below" is drawable. "The mystery of dark matter" is not.
- Do not describe colours or style — those are fixed for the whole site and get added after you.

Good: "A single tank shaped like a drum, deep underground, with rock layers stacked above it and one faint flash of light inside."
Bad: "An artistic representation of dark matter detection." (nothing to draw)
Bad: "The LZ detector at Sanford Lab." (proper names)`;

/** 개념 선택이 읽을 기사 요약. 본문 전체를 싣지 않는다 — 요지면 충분하다 */
export function buildArticleBrief(article: {
  title: string;
  oneLineSummary: string;
  sections: readonly { heading: string; paragraphs: string[] }[];
}): string {
  const sections = article.sections
    .map((section) => `- ${section.heading}: ${section.paragraphs[0] ?? ''}`)
    .join('\n');

  return `TITLE: ${article.title}\nSUMMARY: ${article.oneLineSummary}\n\nSECTIONS\n${sections}`;
}
