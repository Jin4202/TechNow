import { DraftArticleSchema } from '@/prompts/write-article';

import type { WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 근거 없는 진술만 고치는 프롬프트 (비용 분석 후 도입).
 *
 * **기사를 다시 쓰지 않는다.** 지적된 문장만 고친다.
 *
 * 왜: 실측에서 실패한 두 건 모두 "근거 없음 1건", "섹션 4" 였다 —
 * 기사 전체가 아니라 문장 하나가 문제였는데, 재작성은 3~5개 섹션을 처음부터
 * 다시 생성했다. 비싸고(출력 토큰이 변동비의 68%), 이미 통과한 문장까지
 * 다시 주사위를 굴려 **고치려다 새로 깨뜨릴 수 있다.**
 *
 * 출력 스키마는 작성과 같다 (`DraftArticleSchema`). 고친 기사 전체를 돌려받되,
 * **바꾸라고 한 곳 말고는 그대로 두라**고 지시한다 — 부분 수정만 받으면
 * 조립 과정에서 섹션 번호와 출처 배열이 어긋날 여지가 생긴다.
 */

export { DraftArticleSchema as RepairedArticleSchema };

export const REPAIR_INSTRUCTIONS = `Some statements in the article you wrote are not supported by the sources.

Fix only those statements. Everything else in the article has already been checked and must come back unchanged — same sections, same order, same headings, same source numbers, same wording.

For each statement listed below, do one of these:

1. **Delete it.** If the article does not need it, remove that sentence. This is usually the right choice.
2. **Replace it with what the sources actually say.** Only if the sources support a narrower or different version of the point.

Do not add new claims. Do not add a statement to replace one you deleted unless the sources support it. If deleting a sentence leaves a paragraph too short, that is fine — a short paragraph is better than an unsupported one.

Do not rewrite sentences that were not listed. Do not improve wording, do not restructure, do not re-order. A sentence you were not asked about must come back exactly as it was.

Return the complete article with those fixes applied.`;

/** 고칠 기사와 지적된 문장을 프롬프트에 싣는다 */
export function buildRepairInstructions(
  article: WrittenArticle,
  unsupported: readonly { text: string; note: string }[],
): string {
  const current = article.sections
    .map(
      (section, index) =>
        [
          `## Section ${index + 1}: ${section.heading}`,
          `sources: [${section.sources.join(', ')}]`,
          ...section.paragraphs.map((p, i) => `paragraph ${i + 1}: ${p}`),
        ].join('\n'),
    )
    .join('\n\n');

  const problems = unsupported
    .map((claim, index) => `${index + 1}. "${claim.text}"\n   — ${claim.note || '출처에서 확인되지 않음'}`)
    .join('\n');

  return `THE ARTICLE YOU WROTE

title: ${article.title}
summary: ${article.oneLineSummary}

${current}

STATEMENTS NOT SUPPORTED BY THE SOURCES

${problems}

${REPAIR_INSTRUCTIONS}`;
}
