import { addUsage, ZERO_USAGE, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { requiredAssets } from '@/config/required-assets';
import { insertArticleWithSources } from '@/db/articles';
import { insertSourceTexts } from '@/db/source-texts';
import { fillAssets } from '@/pipeline/fill-assets';
import { createFetchContext } from '@/pipeline/research/fetch-page';
import { researchTopic } from '@/pipeline/research/research-topic';
import { buildArticle, type BuildFailure } from '@/pipeline/write/build-article';
import { makeSlug } from '@/pipeline/write/slug';

import type { BraveClient } from '@/clients/brave';
import type { ServiceClient } from '@/db/supabase/service';
import type { PromptSource } from '@/prompts/grounded-steps';

/**
 * 토픽 하나를 기사로 만든다 (로드맵 3.12, 3.15).
 *
 * 조사 → 출처 저장 → 작성 → 근거 검증 → 저장.
 *
 * Trigger.dev 에 의존하지 않는다. 자식 태스크가 이 함수를 부르기만 한다
 * (CLAUDE.md §3). 덕분에 로컬에서 fixture 없이도 전체 흐름을 검증할 수 있다.
 */

export type TopicFailure =
  /** 조사 단계에서 쓸 만한 출처를 못 모음 */
  | 'research-failed'
  /** 작성·검증 단계 실패 */
  | BuildFailure;

export interface BuildTopicInput {
  runId: string;
  topicHash: string;
  topicTitle: string;
  items: { title: string; description: string }[];
  followUpOf: string | null;
  scores: { novelty: number; impact: number; interest: number; total: number };
}

export interface BuildTopicResult {
  articleId: string | null;
  failure: TopicFailure | null;
  detail?: string;
  /** 작성 시도 횟수 */
  attempts: number;
  searchCalls: number;
  pagesFetched: number;
  sourceCount: number;

  /**
   * 단계별로 모델이 다르므로 사용량을 나눠 돌려준다 (D-07 의 비용 로그).
   *
   * 하나로 합쳐 Sonnet 단가로 계산하면 Haiku 부분이 2배로 잡힌다.
   * 예산 경보가 실제보다 일찍 울려 잘못된 판단을 부른다.
   */
  usageHaiku: TokenUsage;
  usageSonnet: TokenUsage;

  /** 만든 필수 자산 (4.4). 번역이 여기 들어온다 */
  assetsFilled?: string[];
  /** 자산을 못 채워 발행 대기로 남았는가 */
  awaitingAssets?: boolean;
}

/**
 * 필수 자산이 다 갖춰졌는지에 따라 상태가 갈린다.
 *
 * Phase 3 에서는 영문 본문만 필수라 바로 `ready` 다.
 * Phase 4~5 에서 번역·이미지가 필수 목록에 들어오면 `ready_pending` 으로 들어와
 * 그 단계들이 끝난 뒤에 `ready` 로 승격된다.
 */
export function initialStatus(): 'ready' | 'ready_pending' {
  const onlyEnglishBody = requiredAssets.length === 1 && requiredAssets[0] === 'english_body';
  return onlyEnglishBody ? 'ready' : 'ready_pending';
}

export async function buildTopic(
  db: ServiceClient,
  claude: AnthropicClient,
  brave: BraveClient,
  input: BuildTopicInput,
): Promise<BuildTopicResult> {
  // ── 조사 ────────────────────────────────────────────────
  const research = await researchTopic(claude, brave, createFetchContext(), {
    title: input.topicTitle,
    items: input.items,
  });

  // 쿼리 생성은 Haiku 다 (models.generateQueries)
  const usageHaiku = research.usage;

  if (research.skipped) {
    return {
      articleId: null,
      failure: 'research-failed',
      detail: `${research.skipped} (출처 ${research.sources.length}건)`,
      attempts: 0,
      searchCalls: research.searchCalls,
      pagesFetched: research.pagesFetched,
      sourceCount: research.sources.length,
      usageHaiku,
      usageSonnet: ZERO_USAGE,
    };
  }

  // ordinal 은 1부터. 기사 본문의 sources 배열이 이 번호를 가리킨다 (D-03)
  const sources: PromptSource[] = research.sources.map((source, index) => ({
    ordinal: index + 1,
    url: source.url,
    title: source.title,
    publisher: source.publisher,
    tier: source.tier,
    text: source.text,
  }));

  // 본문은 태스크 페이로드가 아니라 DB 에 둔다 (D-05).
  // 수십 KB 를 페이로드로 넘기면 재시도마다 다시 실린다
  await insertSourceTexts(
    db,
    input.runId,
    input.topicHash,
    research.sources.map((s, i) => ({ ...s, ordinal: i + 1 })),
  );

  // ── 작성 + 근거 검증 ────────────────────────────────────
  const built = await buildArticle(claude, {
    topicTitle: input.topicTitle,
    sources,
    tier1CandidatesSeen: research.tier1CandidatesSeen,
  });
  // 작성·재작성·검증은 Sonnet, 클레임 추출만 Haiku 다 (D-24).
  // 추출은 전체의 일부라 Sonnet 단가로 잡아도 오차가 작고, 안전한 쪽(과대추정)이다
  const usageSonnet = built.usage;

  if (!built.article) {
    return {
      articleId: null,
      failure: built.failure,
      detail: built.detail,
      attempts: built.attempts,
      searchCalls: research.searchCalls,
      pagesFetched: research.pagesFetched,
      sourceCount: sources.length,
      usageHaiku,
      usageSonnet,
    };
  }

  // ── 저장 ────────────────────────────────────────────────
  const articleId = await insertArticleWithSources(db, {
    slug: makeSlug(built.article.title, input.topicHash),
    category: built.article.category,
    tags: built.article.tags,
    title: built.article.title,
    oneLineSummary: built.article.oneLineSummary,
    body: { sections: built.article.sections },
    runId: input.runId,
    topicHash: input.topicHash,
    followUpOf: input.followUpOf,
    scoreNovelty: input.scores.novelty,
    scoreImpact: input.scores.impact,
    scoreInterest: input.scores.interest,
    importanceScore: input.scores.total,
    status: initialStatus(),
    sources: sources.map((s) => ({
      ordinal: s.ordinal,
      url: s.url,
      title: s.title,
      publisher: s.publisher,
      tier: s.tier,
    })),
  });

  // ── 필수 자산 (4.4) ─────────────────────────────────────
  //
  // 기사 본문 말고 더 필요한 것이 있으면 여기서 만든다. Phase 4 에서는 한국어 번역이다.
  // 실패해도 기사 생성 자체는 성공이다 — `ready_pending` 으로 남고 다음 런의
  // 스윕이 다시 시도한다 (기획서 §2.3). 여기서 실패로 뒤집으면 조사·작성 비용을
  // 버리고 처음부터 다시 하게 된다
  const assets = articleId
    ? await fillAssets(db, claude, {
        id: articleId,
        title: built.article.title,
        oneLineSummary: built.article.oneLineSummary,
        sections: built.article.sections,
        locales: [],
      })
    : null;

  return {
    articleId,
    failure: null,
    attempts: built.attempts,
    searchCalls: research.searchCalls,
    pagesFetched: research.pagesFetched,
    sourceCount: sources.length,
    usageHaiku,
    // 번역도 Sonnet 이다 (CLAUDE.md §2.7)
    usageSonnet: assets ? addUsage(usageSonnet, assets.usage) : usageSonnet,
    assetsFilled: assets?.filled ?? [],
    awaitingAssets: assets ? !assets.ready : false,
  };
}
