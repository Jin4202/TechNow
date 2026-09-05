import { z } from 'zod';

/**
 * 번역 프롬프트 (로드맵 4.3).
 *
 * 영문 기사를 한국어로 옮긴다. 기획서 §2.3 의 제약:
 *   - 번역만 한다. 구조와 사실은 바뀌지 않는다
 *   - 전문용어는 첫 등장에 영문을 병기할 수 있다
 *   - 출처 목록은 번역하지 않는다 (제목·매체명은 원문 그대로 표기한다)
 *
 * **출처 본문을 싣지 않는다.** 번역은 기사만 읽으면 되는 단계라 D-06 의 캐시
 * 프리픽스와 무관하다. 여기서 출처를 붙이면 캐시를 공유하지도 못하면서
 * 12k 토큰을 더 낸다.
 *
 * 구조는 모델이 지어내지 않고 원문을 그대로 따라야 한다 — 섹션 수와 각 섹션의
 * `sources` 배열이 원문과 다르면 4.3a 가 실패로 처리한다 (D-03).
 */

export const KoreanSectionSchema = z.object({
  heading: z.string().describe('Translated section heading.'),
  paragraphs: z.array(z.string()).describe('Translated paragraphs, same count and order.'),
  sources: z.array(z.number().int()).describe('Copy the source numbers unchanged.'),
});

export const KoreanArticleSchema = z.object({
  title: z.string().describe('Translated title.'),
  one_line_summary: z.string().describe('Translated one-line summary.'),
  sections: z.array(KoreanSectionSchema).describe('Same number of sections, same order.'),
});

export type KoreanArticle = z.infer<typeof KoreanArticleSchema>;

export const TRANSLATE_SYSTEM = `You translate science and technology articles from English into Korean for a general audience.

You are translating, not rewriting. The Korean version says exactly what the English version says: the same claims, the same numbers, the same hedges, in the same order. You add nothing and you leave nothing out.

The structure is fixed. Return the same number of sections in the same order, each with the same number of paragraphs, and copy each section's source numbers exactly as given.`;

export const TRANSLATE_INSTRUCTIONS = `Translate the article above into Korean.

WHAT MUST NOT CHANGE
- The number of sections, their order, and each section's "sources" array. Copy the numbers as they are.
- The number of paragraphs in each section, and their order.
- Every number, unit, date, name, and institution. Do not convert units and do not round.
- Hedges. "preliminary", "in mice", "not yet peer reviewed", "about one in two hundred" — a hedge dropped in translation is a claim the article did not make.

TERMS
- On first mention, give the Korean term with the English in parentheses: 초전도체(superconductor).
  After that, use the Korean term alone.
- When there is no settled Korean term, keep the English and explain it in Korean once.
- Do not translate proper nouns that readers will search for: instrument names, mission names, company names, and the names of people. Leave those in English.

KOREAN THAT READS AS KOREAN
- Write the way Korean science writing is written, not the way English maps onto Korean.
  Break an English sentence into two when a single Korean sentence would run long, but keep the paragraph's sentence boundaries where you can — the paragraph must still make the same points in the same order.
- Use plain declarative 합니다체 ("…입니다", "…합니다"). Not 하십시오체, not 반말.
- Avoid English word order carried over word by word ("~에 의해 ~되어졌다"). Prefer active phrasing.
- Do not add emphasis the English did not have. No exclamation marks.

TITLE AND SUMMARY
- The title says what happened, in Korean, in the same register as the English one. Not a teaser.
- The summary says why it matters. It is not the title again.`;
