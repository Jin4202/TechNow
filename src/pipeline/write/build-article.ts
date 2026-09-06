import { addUsage, ZERO_USAGE, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { budget } from '@/config/budget';
import { thresholds } from '@/config/thresholds';
import { buildRetryNote, verifyArticle, type VerificationResult } from '@/pipeline/verify/verify-claims';
import {
  repairArticle,
  writeArticle,
  type WriteFailure,
  type WriteResult,
  type WrittenArticle,
} from '@/pipeline/write/write-article';

import type { PromptSource } from '@/prompts/grounded-steps';

/**
 * 출처에서 기사 하나를 만들어 낸다 (로드맵 3.9, 3.10).
 *
 * 작성 → 검증 → (실패 시) 1회 수정 → 재검증 → 그래도 실패하면 skip.
 *
 * **수정은 기사 전체를 다시 쓰는 것이 아니라 지적된 문장만 고치는 것이다.**
 * 실측에서 실패한 건들이 "근거 없음 1건" 처럼 아슬아슬했는데, 전체 재작성은
 * 이미 통과한 문장까지 다시 굴려 고치려다 새로 깨뜨렸다.
 * `TECHNOW_FULL_REWRITE=1` 로 옛 방식(전체 재작성)을 켤 수 있다 — 비교 측정용이다.
 *
 * **근거 검증을 통과하지 못한 기사는 발행하지 않는다.** 완화하는 방향의 수정은
 * 하지 않는다 (CLAUDE.md §2.5). 기사 수가 줄어드는 건 의도된 비용이다.
 */

export type BuildFailure =
  /** 3.10 — 출처가 최소 수에 못 미침 */
  | 'too-few-sources'
  /** 3.10 — Tier 1 후보가 있었는데 최종 출처에 Tier 1 이 없음 */
  | 'no-tier1'
  /** 모델이 규격에 맞는 기사를 못 냄 */
  | 'write-failed'
  /** 재작성까지 했는데 근거 없는 진술이 남음 */
  | 'grounding-failed'
  /** 검증 호출 자체가 실패 */
  | 'verify-error';

export interface BuildArticleResult {
  article: WrittenArticle | null;
  failure: BuildFailure | null;
  detail?: string;
  /** 작성 시도 횟수. 1 이면 첫 시도에 통과 */
  attempts: number;
  usage: TokenUsage;
  /** 마지막 검증 결과. 로그와 진단용 */
  verification: VerificationResult | null;
}

export interface BuildArticleInput {
  topicTitle: string;
  sources: readonly PromptSource[];
  /** 조사 단계가 본 Tier 1 후보 수 (3.10 판정용) */
  tier1CandidatesSeen: number;
}

/**
 * 3.10 의 출처 규칙.
 *
 * Tier 1 규칙은 "존재한다면" 이 조건이다 — 애초에 Tier 1 후보가 없던 토픽까지
 * 막으면 Tier 2 만 다루는 분야가 통째로 사라진다.
 */
export function checkSourceRules(
  sources: readonly PromptSource[],
  tier1CandidatesSeen: number,
): { failure: BuildFailure; detail: string } | null {
  if (sources.length < budget.minSources) {
    return { failure: 'too-few-sources', detail: `${sources.length}건` };
  }

  const hasTier1 = sources.some((s) => s.tier === 1);
  if (!hasTier1 && tier1CandidatesSeen > 0) {
    return {
      failure: 'no-tier1',
      detail: `Tier 1 후보 ${tier1CandidatesSeen}건이 있었으나 확보하지 못함`,
    };
  }

  return null;
}

const MAX_ATTEMPTS = 2;

export async function buildArticle(
  claude: AnthropicClient,
  input: BuildArticleInput,
): Promise<BuildArticleResult> {
  const ruleFailure = checkSourceRules(input.sources, input.tier1CandidatesSeen);
  if (ruleFailure) {
    return {
      article: null,
      failure: ruleFailure.failure,
      detail: ruleFailure.detail,
      attempts: 0,
      usage: ZERO_USAGE,
      verification: null,
    };
  }

  let usage = ZERO_USAGE;
  let retryNote: string | undefined;
  let lastVerification: VerificationResult | null = null;
  let lastWriteFailure: WriteFailure | null = null;
  let lastDetail: string | undefined;
  /** 직전 시도의 기사. 있으면 전체 재작성 대신 이것을 고친다 */
  let previous: WrittenArticle | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // 근거 없는 진술만 지적된 상황이면 그 문장만 고친다.
    // 규격 위반(write-failed)은 고칠 기사가 온전하지 않으므로 다시 쓴다
    const repairable: boolean =
      previous !== null &&
      lastVerification !== null &&
      lastVerification.unsupported.length > 0 &&
      !thresholds.fullRewriteOnGroundingFailure;

    const written: WriteResult = repairable
      ? await repairArticle(
          claude,
          previous!,
          input.sources,
          lastVerification!.unsupported.map((c) => ({ text: c.claim.text, note: c.note })),
        )
      : await writeArticle(claude, input.topicTitle, input.sources, retryNote);

    usage = addUsage(usage, written.usage);

    if (!written.article) {
      lastWriteFailure = written.failure;
      lastDetail = written.detail;
      // 규격을 못 맞춘 것도 재시도 대상이다. 사유를 붙여 다시 시킨다
      retryNote = `The draft was rejected: ${written.failure} (${written.detail ?? ''}).`;
      continue;
    }

    previous = written.article;

    const verification = await verifyArticle(claude, written.article, input.sources);
    usage = addUsage(usage, verification.usage);
    lastVerification = verification;

    if (verification.passed) {
      return { article: written.article, failure: null, attempts: attempt, usage, verification };
    }

    // 검증 호출 자체가 실패한 경우는 근거 문제와 구분한다
    if (verification.error) {
      lastDetail = verification.error;
      retryNote = undefined;
      continue;
    }

    retryNote = `These statements were not supported by the sources:\n${buildRetryNote(verification.unsupported)}\nRemove them, or replace them with what the sources actually say. Do not add new claims.`;
    lastDetail = `근거 없음 ${verification.unsupported.length}건`;
  }

  const failure: BuildFailure = lastVerification?.error
    ? 'verify-error'
    : lastVerification
      ? 'grounding-failed'
      : 'write-failed';

  return {
    article: null,
    failure,
    detail: lastDetail ?? lastWriteFailure ?? undefined,
    attempts: MAX_ATTEMPTS,
    usage,
    verification: lastVerification,
  };
}
