import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import {
  addUsage,
  readUsage,
  ZERO_USAGE,
  type AnthropicClient,
  type TokenUsage,
} from '@/clients/anthropic';
import { EFFORT, models } from '@/config/models';
import {
  buildGroundedMessages,
  buildSourceBlock,
  GROUNDED_SYSTEM,
  type PromptSource,
} from '@/prompts/grounded-steps';
import {
  buildExtractPrompt,
  buildVerifyPrompt,
  ClaimListSchema,
  EXTRACT_SYSTEM,
  VerificationSchema,
  type Claim,
  type Verdict,
} from '@/prompts/verify-claims';

import type { WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 근거 검증 (로드맵 3.7, 3.8).
 *
 * 이 단계가 발행 여부를 정한다. **엄격하다** — 근거 없는 진술 하나가 발행을 막는다.
 * 완화하는 방향의 수정은 하지 않는다 (CLAUDE.md §2.5).
 *
 * 통과는 사실의 증명이 아니라 방어선이다.
 */

export interface CheckedClaim {
  claim: Claim;
  supported: boolean;
  sourceOrdinals: number[];
  note: string;
}

export interface VerificationResult {
  passed: boolean;
  claims: CheckedClaim[];
  /** 근거 없는 진술. 재작성 프롬프트에 그대로 들어간다 (3.9) */
  unsupported: CheckedClaim[];
  usage: TokenUsage;
  /** 검증 자체가 실패한 경우. passed 는 false 이고 재시도 대상이다 */
  error: string | null;
}

/** 기사만 읽고 검증 가능한 진술을 뽑는다 (3.7, Haiku — D-24) */
export async function extractClaims(
  claude: AnthropicClient,
  article: WrittenArticle,
): Promise<{ claims: Claim[]; usage: TokenUsage }> {
  const response = await claude.messages.parse({
    model: models.extractClaims,
    max_tokens: 4000,
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: buildExtractPrompt({
          title: article.title,
          oneLineSummary: article.oneLineSummary,
          sections: article.sections,
        }),
      },
    ],
    output_config: { format: zodOutputFormat(ClaimListSchema) },
  });

  return {
    claims: response.parsed_output?.claims ?? [],
    usage: readUsage(response.usage),
  };
}

/** 각 진술을 출처 본문과 대조한다 (3.8, Sonnet + 캐시된 출처 블록) */
export async function checkClaims(
  claude: AnthropicClient,
  sources: readonly PromptSource[],
  claims: readonly Claim[],
): Promise<{ verdicts: Verdict[]; usage: TokenUsage }> {
  const response = await claude.messages.parse({
    model: models.verifyClaims,
    max_tokens: 8000,
    system: GROUNDED_SYSTEM,
    messages: buildGroundedMessages(buildSourceBlock(sources), buildVerifyPrompt(claims)),
    output_config: {
      format: zodOutputFormat(VerificationSchema),
      effort: EFFORT.verifyClaims,
    },
  });

  return {
    verdicts: response.parsed_output?.verdicts ?? [],
    usage: readUsage(response.usage),
  };
}

/**
 * 진술을 뽑고 대조한다.
 *
 * 판정을 받지 못한 진술은 **근거 없음으로 취급한다.** 검증을 건너뛴 진술이
 * 통과로 처리되면 검증 단계 전체가 무의미해진다.
 */
export async function verifyArticle(
  claude: AnthropicClient,
  article: WrittenArticle,
  sources: readonly PromptSource[],
): Promise<VerificationResult> {
  let usage = ZERO_USAGE;

  let claims: Claim[];
  try {
    const extracted = await extractClaims(claude, article);
    claims = extracted.claims;
    usage = addUsage(usage, extracted.usage);
  } catch (error) {
    return {
      passed: false,
      claims: [],
      unsupported: [],
      usage,
      error: `클레임 추출 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // 진술이 하나도 없으면 검증할 것이 없다는 뜻이 아니라 추출이 실패한 것이다.
  // 사실을 담은 기사에 검증 가능한 진술이 0개일 수는 없다
  if (claims.length === 0) {
    return { passed: false, claims: [], unsupported: [], usage, error: '추출된 진술이 없음' };
  }

  let verdicts: Verdict[];
  try {
    const checked = await checkClaims(claude, sources, claims);
    verdicts = checked.verdicts;
    usage = addUsage(usage, checked.usage);
  } catch (error) {
    return {
      passed: false,
      claims: [],
      unsupported: [],
      usage,
      error: `대조 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const known = new Set(sources.map((s) => s.ordinal));
  const byIndex = new Map(verdicts.map((v) => [v.claimIndex, v]));

  const checked: CheckedClaim[] = claims.map((claim, index) => {
    const verdict = byIndex.get(index);

    // 판정이 없으면 근거 없음이다
    if (!verdict) {
      return { claim, supported: false, sourceOrdinals: [], note: '판정 없음' };
    }

    // 존재하지 않는 출처를 근거로 들면 근거가 아니다
    const ordinals = verdict.sourceOrdinals.filter((o) => known.has(o));
    const supported = verdict.supported && ordinals.length > 0;

    return {
      claim,
      supported,
      sourceOrdinals: ordinals,
      note:
        verdict.supported && ordinals.length === 0
          ? `근거로 든 출처가 존재하지 않음: ${verdict.sourceOrdinals.join(', ')}`
          : verdict.note.trim(),
    };
  });

  const unsupported = checked.filter((c) => !c.supported);

  return {
    passed: unsupported.length === 0,
    claims: checked,
    unsupported,
    usage,
    error: null,
  };
}

/** 재작성 프롬프트에 붙일 실패 사유 (3.9) */
export function buildRetryNote(unsupported: readonly CheckedClaim[]): string {
  return unsupported
    .map((c) => `- "${c.claim.text}" — ${c.note || '출처에서 확인되지 않음'}`)
    .join('\n');
}
