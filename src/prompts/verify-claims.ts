import { z } from 'zod';

/**
 * 근거 검증 프롬프트 (로드맵 3.7, 3.8).
 *
 * 두 단계로 나눈다:
 *   추출 — 기사만 읽고 검증 가능한 진술을 뽑는다 (Haiku, 출처 불필요 D-24)
 *   대조 — 각 진술을 출처 본문과 맞춰본다 (Sonnet, 캐시된 출처 블록 사용)
 *
 * 추출이 출처를 보지 않는 것은 의도적이다. 출처를 먼저 보면 "출처에 있는 것만
 * 진술로 뽑는" 편향이 생겨 검증이 자기충족적이 된다.
 *
 * 문자열 매칭은 쓰지 않는다. "5 million" 과 "5,000,000" 에서 실패한다 (기획서 §2.2).
 */

// ── 추출 (3.7) ────────────────────────────────────────────

export const ClaimSchema = z.object({
  text: z.string().describe('The claim, quoted or closely paraphrased from the article.'),
  /**
   * 분류 라벨. **판정에 쓰이지 않는다** — 대조 프롬프트에 `[0] (number) ...` 로
   * 찍히는 표시용이다.
   *
   * enum 이었는데 문자열로 풀었다 (D-50). 프로덕션에서 모델이 목록에 없는 값을
   * 하나 내놓자 zod 가 응답 전체를 거부했고, **아무 로직도 태우지 않는 라벨 때문에
   * 완성된 기사가 통째로 버려졌다.** 실패해도 되는 것과 안 되는 것을 구분한다 —
   * 근거 판정은 엄격해야 하지만(CLAUDE.md §2.5) 라벨은 아니다.
   *
   * 목록은 지시로 남긴다. 모델은 여전히 이 다섯 중에서 고르려 하고,
   * 빗나가도 파이프라인이 멈추지 않을 뿐이다.
   */
  kind: z
    .string()
    .describe('One of: number, name, date, causal, attribution.'),
  sectionIndex: z.number().int().describe('Zero-based index of the section it appears in.'),
});

export const ClaimListSchema = z.object({
  claims: z.array(ClaimSchema),
});

export type Claim = z.infer<typeof ClaimSchema>;

export const EXTRACT_SYSTEM = `You list the checkable statements in a news article so another reader can verify each one against the original sources.

A checkable statement is one that a source either supports or does not. Extract:
- numbers: quantities, measurements, percentages, counts, durations, money
- names: people, organisations, instruments, missions, materials, organisms
- dates: when something happened or will happen
- causal: X caused Y, X enables Y, X is explained by Y
- attribution: what a named person or group said or concluded

Do not extract:
- definitions of common terms, or explanations a general reader would accept without a source
- transitions and framing sentences that assert nothing
- the article's own hedges ("further work is needed")

Keep each claim short and self-contained. If a sentence contains two checkable facts, that is two claims. Do not merge claims to shorten the list; a missed claim is a claim nobody checks.`;

export function buildExtractPrompt(article: {
  title: string;
  oneLineSummary: string;
  sections: { heading: string; paragraphs: string[] }[];
}): string {
  const body = article.sections
    .map((s, i) => `[SECTION ${i}] ${s.heading}\n${s.paragraphs.join('\n')}`)
    .join('\n\n');

  return `TITLE: ${article.title}
SUMMARY: ${article.oneLineSummary}

${body}

List the checkable statements.`;
}

// ── 대조 (3.8) ────────────────────────────────────────────

export const VerdictSchema = z.object({
  claimIndex: z.number().int().describe('Index of the claim in the list given to you.'),
  supported: z.boolean(),
  sourceOrdinals: z
    .array(z.number().int())
    .describe('Source numbers that support the claim. Empty when unsupported.'),
  note: z
    .string()
    .describe('One line. When unsupported, say what the sources actually say instead.'),
});

export const VerificationSchema = z.object({
  verdicts: z.array(VerdictSchema),
});

export type Verdict = z.infer<typeof VerdictSchema>;

/**
 * 대조 지시문. 출처 블록 뒤에 온다 (D-06).
 *
 * 완료 기준(3.8)이 "조작한 숫자는 걸리고 표기만 다른 참값은 안 걸린다" 이므로
 * 두 방향을 모두 명시한다.
 */
export const VERIFY_INSTRUCTIONS = `For each claim below, decide whether the source texts above support it.

SUPPORTED means a source states it, or states something the claim follows from directly. The wording does not have to match.

These are all supported:
- "5 million" against a source saying "5,000,000" or "five million"
- "about 4,000 cycles" against a source saying "3,978 cycles"
- "roughly a third" against a source saying "31 percent"
- "the team at MIT" against a source saying "researchers at the Massachusetts Institute of Technology"
- "published in Nature" against a source whose own header shows it is a Nature article

These are NOT supported:
- a number no source gives, even if it is close to one that appears
- a number from the right source but the wrong measurement
- a causal statement where the sources only show correlation
- a name, date, or affiliation that appears nowhere
- "experts say" or "researchers believe" with no source saying it
- a claim that drops a hedge the source made ("in mice", "preliminary", "not yet peer reviewed")

Rules:
- Judge each claim on its own. Do not let a nearby supported claim carry an unsupported one.
- Cite the source numbers you actually used. If you cannot name one, the claim is not supported.
- Arithmetic the sources make possible is supported; arithmetic you had to invent inputs for is not.
- When sources disagree and the article picked one silently, that is not supported.
- You have no knowledge outside these sources. A claim you know to be true from elsewhere is still unsupported here.

Return one verdict per claim, using the claim indexes given.`;

export function buildVerifyPrompt(claims: readonly Claim[]): string {
  const list = claims
    .map((claim, index) => `[${index}] (${claim.kind}) ${claim.text}`)
    .join('\n');

  return `${VERIFY_INSTRUCTIONS}

CLAIMS
${list}`;
}
