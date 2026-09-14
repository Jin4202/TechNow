import { addUsage, estimateCost, ZERO_USAGE, type TokenUsage } from '@/clients/anthropic';
import { budget } from '@/config/budget';
import { feeds } from '@/config/feeds';
import { activeProfile } from '@/config/profiles';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_HAIKU,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { thresholds } from '@/config/thresholds';
import {
  projectMonthlyCost,
  variableCostUsd,
  type CostProjection,
} from '@/pipeline/cost-projection';
import { sweepPendingAssets, type SweepResult } from '@/pipeline/fill-assets';
import { recentPublishedArticles } from '@/db/articles';
import { finishRun, startRun } from '@/db/pipeline-runs';
import { insertRunTopics, type RunTopicRow } from '@/db/run-topics';
import {
  cleanupSeenItems,
  getSeenRows,
  insertPending,
  markProcessed,
} from '@/db/seen-feed-items';
import { cleanupRateLimits } from '@/db/rate-limit';
import { cleanupSourceTexts } from '@/db/source-texts';
import { applyCheapFilters, summarizeRejections } from '@/pipeline/discover/cheap-filters';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { partitionCandidates } from '@/pipeline/discover/partition-candidates';
import { groupTopics, type Topic } from '@/pipeline/group/group-topics';
import { topicHash } from '@/pipeline/group/topic-hash';
import { rescoreTopics, selectForRescore } from '@/pipeline/score/rescore';
import { scoreTopics, type ScoredTopic } from '@/pipeline/score/score-topics';
import {
  finalizeEntries,
  nextCandidate,
  rankPassing,
  summarizeSelection,
  type BuiltTopic,
} from '@/pipeline/score/select-topics';
import { createFetchContext } from '@/pipeline/research/fetch-page';

import type { AnthropicClient } from '@/clients/anthropic';
import type { FalClient } from '@/clients/fal';
import type { ServiceClient } from '@/db/supabase/service';
import type { BuildTopicInput, BuildTopicResult } from '@/pipeline/build-topic';
import type { FeedFailure } from '@/pipeline/discover/fetch-feeds';

/**
 * 일간 파이프라인 (로드맵 1.6~1.11, 2.1~2.7, 3.12).
 *
 * Trigger.dev 에 의존하지 않는다 (CLAUDE.md §3). 기사 생성은 주입받은 함수가 한다 —
 * 프로덕션에서는 자식 태스크를 부르고, 테스트에서는 직접 부른다.
 *
 * 흐름:
 *   수집 → 저비용 필터 → 후보 선별 → pending 기록
 *        → 그룹핑 → 1차 채점 → 근접 재채점 → 선정
 *        → **순위대로 기사 생성 (실패하면 다음 순위)** → run_topics → processed → 정리
 *
 * 발행은 별도 스케줄이 한다 (D-04). 여기서는 기사를 `ready` 까지만 만든다.
 */

/** 기사 생성기. 프로덕션은 자식 태스크, 테스트는 직접 호출 */
export type TopicBuilder = (input: BuildTopicInput) => Promise<BuildTopicResult>;

export interface DailyRunResult {
  runId: string;
  /** 이 런이 쓴 발행 프로필 (D-61) */
  profile: string;
  uniqueItems: number;
  filtered: Record<string, number>;
  candidates: number;
  newlyRecorded: number;
  resumed: number;
  skipped: number;
  topics: number;
  groupingFellBack: boolean;
  rescored: number;
  selection: ReturnType<typeof summarizeSelection>;
  /** 실제로 만들어진 기사 수 */
  articlesBuilt: number;
  /** 이전 런에서 남은 기사의 자산 채우기 결과 (4.4) */
  sweep: SweepResult;
  /** 생성을 시도한 토픽 수. 실패해서 다음 순위로 내려간 횟수를 알 수 있다 */
  buildAttempts: number;
  buildFailures: { topicTitle: string; failure: string; detail: string }[];
  costFixed: number;
  costVariable: number;
  projection: CostProjection;
  failures: FeedFailure[];
  cleaned: {
    pendingDeleted: number;
    processedDeleted: number;
    sourceTextsDeleted: number;
    rateLimitsDeleted: number;
  };
}

export interface DailyRunOptions {
  buildTopic: TopicBuilder;
  onWarn?: (message: string, data: Record<string, unknown>) => void;
  onInfo?: (message: string, data: Record<string, unknown>) => void;
}

function triggerUrl(topic: Topic): string {
  return topic.items[0]?.url ?? '';
}

export async function runDailyDiscovery(
  db: ServiceClient,
  claude: AnthropicClient,
  fal: FalClient,
  options: DailyRunOptions,
): Promise<DailyRunResult> {
  // 프로필은 런 시작에 한 번 읽는다. 런 도중 환경변수가 바뀌어도 한 런 안에서는 규칙이 같아야 한다
  const profile = activeProfile();
  const runId = await startRun(db, 'daily', { profile: profile.name });
  const warn = options.onWarn ?? (() => {});
  const info = options.onInfo ?? (() => {});

  try {
    // ── 어제 남은 기사의 자산 채우기 (4.4) ──────────────────
    //
    // 오늘 기사를 만들기 **전**에 한다. 어제 번역에 실패한 기사가 오늘 아침
    // 발행에 들어가야 하고, 오늘 작업이 어디서 막히든 어제 것은 이미 끝나 있어야 한다
    const sweep = await sweepPendingAssets(db, claude, fal, { onInfo: info });
    if (sweep.scanned > 0) {
      info('대기 기사 자산 스윕', {
        scanned: sweep.scanned,
        promoted: sweep.promoted,
        stillWaiting: sweep.stillWaiting,
      });
    }

    // ── 수집 ────────────────────────────────────────────────
    const { items, failures } = await fetchFeeds(feeds);
    const unique = dedupeItems(items);
    for (const failure of failures) warn('피드 수집 실패', { ...failure });

    // ── 저비용 필터 (2.1) ───────────────────────────────────
    const { kept, rejected } = applyCheapFilters(unique);
    const filtered = summarizeRejections(rejected);

    // ── 후보 선별 (D-01) ────────────────────────────────────
    const seen = await getSeenRows(db, kept.map((i) => i.urlHash));
    const { candidates, toInsert, resumedCount, skippedCount } = partitionCandidates(kept, seen);
    await insertPending(db, toInsert, runId);

    info('후보 선별 완료', {
      unique: unique.length,
      filtered,
      candidates: candidates.length,
      resumed: resumedCount,
      skipped: skippedCount,
    });

    // ── 그룹핑 + follow-up (2.2, 2.3) ───────────────────────
    const recent = await recentPublishedArticles(db, thresholds.followUpWindowDays);
    const grouping = await groupTopics(claude, candidates, recent);
    if (grouping.usedFallback) warn('그룹핑 폴백', { reason: grouping.fallbackReason ?? '' });
    const topics = grouping.topics;
    const recentById = new Map(recent.map((r) => [r.id, r.title]));

    // ── 1차 채점 (2.4) ──────────────────────────────────────
    const scoring = await scoreTopics(
      claude,
      topics.map((t) => ({
        title: t.title,
        items: t.items.map((i) => ({ title: i.title, description: i.description })),
        followUpOfTitle: t.followUpOfArticleId
          ? (recentById.get(t.followUpOfArticleId) ?? null)
          : null,
      })),
    );
    for (const error of scoring.failedChunks) warn('채점 청크 실패', { error });

    // ── 근접 재채점 (2.5, D-19) ─────────────────────────────
    const rescore = await rescoreTopics(
      claude,
      createFetchContext(),
      selectForRescore(scoring.scored, profile.rescoreTopN).map((score) => ({
        score,
        title: topics[score.index]!.title,
        triggerUrl: triggerUrl(topics[score.index]!),
        followUpOfTitle: topics[score.index]!.followUpOfArticleId
          ? (recentById.get(topics[score.index]!.followUpOfArticleId!) ?? null)
          : null,
      })),
    );

    const finalScores = new Map<number, ScoredTopic>(scoring.scored.map((s) => [s.index, s]));
    const firstPassTotals = new Map<number, number>();
    const rescoreSkips = new Map<number, string>();
    for (const outcome of rescore.outcomes) {
      if (outcome.rescored) {
        finalScores.set(outcome.index, outcome.after);
        firstPassTotals.set(outcome.index, outcome.before.total);
      } else if (outcome.reason) {
        rescoreSkips.set(outcome.index, outcome.reason);
      }
    }

    // ── 선정 (2.6, D-61) ────────────────────────────────────
    /**
     * 선정은 미리 계산한 목록이 아니라 **걷는 판정**이다 (D-61).
     *
     * 조사는 정상적으로 실패할 수 있어서(D-21) 무엇이 만들어질지는 걸어봐야 안다.
     * 예전에는 순위 목록을 미리 만들고 차례로 걸었는데, 그 목록에 쿼터에 막힌 논문까지
     * 순위가 붙어 있어서 앞 순위가 실패하면 쿼터를 그대로 지나쳤다
     * (09-14: 쿼터가 고른 것 3편 → 실제로 만들어진 것 5편).
     *
     * 이제 매 시도 전에 "지금까지 실제로 만들어진 것" 을 보고 들일지 정한다.
     * 상한도 같은 판정이 막는다 — 따로 세지 않는다
     */
    const scoredList = [...finalScores.values()].sort((a, b) => a.index - b.index);
    const ranked = rankPassing(scoredList);

    // ── 기사 생성 (3.12, 3.15) ──────────────────────────────
    const articleIdByIndex = new Map<number, string>();
    const buildFailures: { topicTitle: string; failure: string; detail: string }[] = [];
    // 모델별로 나눠 쌓는다. 합쳐서 한 단가로 계산하면 Haiku 부분이 부풀려진다
    let variableHaiku: TokenUsage = ZERO_USAGE;
    // 스윕의 번역 비용도 변동비다. 기사에 붙는 비용이므로 기사당 단가에 들어가야 한다
    let variableSonnet: TokenUsage = sweep.usage;
    let buildAttempts = 0;
    // 스윕이 만든 이미지도 이 런의 비용이다
    let imagesGenerated = sweep.imagesGenerated;
    let searchCalls = 0;
    let pagesFetched = rescore.pagesFetched;
    const tried = new Set<number>();
    const built: BuiltTopic[] = [];

    for (
      let candidate = nextCandidate(ranked, tried, built, profile);
      candidate;
      candidate = nextCandidate(ranked, tried, built, profile)
    ) {
      const index = candidate.index;
      const topic = topics[index]!;
      tried.add(index);
      buildAttempts += 1;

      const result = await options.buildTopic({
        runId,
        topicHash: topicHash(topic.items),
        topicTitle: topic.title,
        items: topic.items.map((i) => ({ title: i.title, description: i.description })),
        followUpOf: topic.followUpOfArticleId,
        scores: {
          novelty: candidate.novelty.score,
          impact: candidate.impact.score,
          interest: candidate.interest.score,
          total: candidate.total,
        },
      });

      variableHaiku = addUsage(variableHaiku, result.usageHaiku);
      variableSonnet = addUsage(variableSonnet, result.usageSonnet);
      searchCalls += result.searchCalls;
      pagesFetched += result.pagesFetched;
      imagesGenerated += result.imagesGenerated ?? 0;

      if (result.articleId) {
        articleIdByIndex.set(index, result.articleId);
        // 분야는 작성이 정한 실제 값으로 센다. 채점의 예측과 다를 수 있다 —
        // 없으면(배포 전 자식 태스크가 돌려준 결과) 예측으로 대신한다
        built.push({ kind: candidate.kind, category: result.category ?? candidate.category });
      } else {
        buildFailures.push({
          topicTitle: topic.title,
          failure: result.failure ?? 'unknown',
          detail: result.detail ?? '',
        });
        warn('기사 생성 실패, 다음 후보로', {
          topicTitle: topic.title,
          failure: result.failure ?? 'unknown',
          detail: result.detail ?? '',
        });
      }
    }

    // 걷기가 끝난 뒤에 사유를 확정한다. 로그가 계획이 아니라 실제로 일어난 일을 말한다
    const entries = finalizeEntries(scoredList, ranked, tried, built, profile);
    const selection = summarizeSelection(entries);

    // ── 판정 기록 (2.7) ─────────────────────────────────────
    const entryByIndex = new Map(entries.map((e) => [e.score.index, e]));
    const rows: RunTopicRow[] = topics.map((topic, index) => {
      const score = finalScores.get(index) ?? null;
      const entry = entryByIndex.get(index) ?? null;
      const articleId = articleIdByIndex.get(index) ?? null;
      const buildFailure = buildFailures.find((f) => f.topicTitle === topic.title);

      return {
        topic_title: topic.title.slice(0, 500),
        item_count: topic.items.length,
        feed_names: [...new Set(topic.items.map((i) => i.feedName))],
        trigger_url: triggerUrl(topic) || null,
        follow_up_of: topic.followUpOfArticleId,
        score_novelty: score?.novelty.score ?? null,
        score_impact: score?.impact.score ?? null,
        score_interest: score?.interest.score ?? null,
        importance_score: score?.total ?? null,
        topic_kind: score?.kind ?? null,
        topic_category: score?.category ?? null,
        reason_novelty: score?.novelty.reason ?? null,
        reason_impact: score?.impact.reason ?? null,
        reason_interest: score?.interest.reason ?? null,
        rescored: firstPassTotals.has(index),
        first_pass_score: firstPassTotals.get(index) ?? null,
        rescore_skip_reason: rescoreSkips.get(index) ?? null,
        // 선정은 "생성을 시도했다" 는 뜻이다. 실패해도 선정된 것이다 —
        // 여기를 articleId 로 판단하면 실제 시도 횟수가 로그에서 사라진다
        selected: articleId !== null || buildFailure !== undefined,
        reject_reason: articleId || buildFailure ? null : entry ? entry.reason : 'unscored',
        rank: entry?.rank ?? null,
        article_id: articleId,
        build_failure: buildFailure?.failure ?? null,
        build_detail: buildFailure?.detail ?? null,
      };
    });
    await insertRunTopics(db, runId, rows);

    // ── 마무리 ──────────────────────────────────────────────
    await markProcessed(db, candidates.map((i) => i.urlHash));
    const seenCleaned = await cleanupSeenItems(db);
    const sourceTextsDeleted = await cleanupSourceTexts(db);
    // 지난 윈도우의 rate limit 카운터 (7.2). 안 지우면 영구히 쌓인다
    const rateLimitsDeleted = await cleanupRateLimits(db);

    // 고정비: 발굴~선정. 기사가 0건인 날에도 발생한다 (D-07)
    const fixedUsage = addUsage(addUsage(grouping.usage, scoring.usage), rescore.usage);
    const multipliers = { cacheRead: CACHE_READ_MULTIPLIER, cacheWrite: CACHE_WRITE_MULTIPLIER };
    const costFixed = estimateCost(fixedUsage, PRICING[MODEL_HAIKU], multipliers);
    // 변동비: 조사~작성 + 커버 이미지. 산수는 cost-projection 이 갖는다 —
    // 여기 두면 테스트가 DB 없이는 못 돈다
    const costVariable = variableCostUsd({
      haiku: variableHaiku,
      sonnet: variableSonnet,
      imagesGenerated,
    });
    const variableUsage = addUsage(variableHaiku, variableSonnet);

    const projection = projectMonthlyCost({
      costFixed,
      costVariable,
      articlesBuilt: articleIdByIndex.size,
    });
    // 막지 않고 남긴다. 하루 표본으로 파이프라인을 멈추면 오탐이 더 비싸다
    if (projection.shouldAlert) {
      warn('이 페이스가 이어지면 월 예산에 근접한다', {
        projectedMonthlyUsd: projection.projectedMonthlyUsd,
        monthlyUsd: budget.monthlyUsd,
        variablePerArticle: projection.variablePerArticle,
      });
    }

    await finishRun(db, runId, 'success', {
      topics_seen: topics.length,
      topics_selected: articleIdByIndex.size,
      articles_published: 0, // 발행은 별도 스케줄이 한다 (D-04)
      cost_search_calls: searchCalls,
      cost_pages_fetched: pagesFetched,
      cost_images: imagesGenerated,
      cost_input_tokens: fixedUsage.inputTokens + variableUsage.inputTokens,
      cost_output_tokens: fixedUsage.outputTokens + variableUsage.outputTokens,
      cost_cached_tokens: fixedUsage.cacheReadTokens + variableUsage.cacheReadTokens,
      cost_fixed: Number(costFixed.toFixed(4)),
      cost_variable: Number(costVariable.toFixed(4)),
      notes:
        `프로필 ${profile.name} · 수집 ${unique.length} → 필터통과 ${kept.length} → 후보 ${candidates.length} → ` +
        `토픽 ${topics.length} → 임계통과 ${selection.passedThreshold} → ` +
        `시도 ${buildAttempts} → 생성 ${articleIdByIndex.size}. 피드실패 ${failures.length}`,
    });

    return {
      runId,
      profile: profile.name,
      uniqueItems: unique.length,
      filtered,
      candidates: candidates.length,
      newlyRecorded: toInsert.length,
      resumed: resumedCount,
      skipped: skippedCount,
      topics: topics.length,
      groupingFellBack: grouping.usedFallback,
      rescored: rescore.outcomes.filter((o) => o.rescored).length,
      selection,
      articlesBuilt: articleIdByIndex.size,
      sweep,
      buildAttempts,
      buildFailures,
      costFixed: Number(costFixed.toFixed(4)),
      costVariable: Number(costVariable.toFixed(4)),
      projection,
      failures,
      cleaned: { ...seenCleaned, sourceTextsDeleted, rateLimitsDeleted },
    };
  } catch (error) {
    // 실패해도 런 기록은 남긴다. pending 항목은 그대로여서 다음 날 재처리된다
    await finishRun(db, runId, 'failed', {
      notes: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
