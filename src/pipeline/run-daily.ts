import { addUsage, estimateCost, type TokenUsage } from '@/clients/anthropic';
import { feeds } from '@/config/feeds';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  models,
  PRICING,
} from '@/config/models';
import { thresholds } from '@/config/thresholds';
import { insertPlaceholders, recentPublishedArticles } from '@/db/articles';
import { finishRun, startRun } from '@/db/pipeline-runs';
import { insertRunTopics, type RunTopicRow } from '@/db/run-topics';
import {
  cleanupSeenItems,
  getSeenRows,
  insertPending,
  markProcessed,
} from '@/db/seen-feed-items';
import { applyCheapFilters, summarizeRejections } from '@/pipeline/discover/cheap-filters';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { makePlaceholder } from '@/pipeline/discover/make-placeholder';
import { partitionCandidates } from '@/pipeline/discover/partition-candidates';
import { groupTopics, type Topic } from '@/pipeline/group/group-topics';
import { rescoreTopics, selectForRescore } from '@/pipeline/score/rescore';
import { scoreTopics, type ScoredTopic } from '@/pipeline/score/score-topics';
import { selectTopics, summarizeSelection } from '@/pipeline/score/select-topics';
import { createFetchContext } from '@/pipeline/research/fetch-page';

import type { AnthropicClient } from '@/clients/anthropic';
import type { ServiceClient } from '@/db/supabase/service';
import type { FeedFailure } from '@/pipeline/discover/fetch-feeds';

/**
 * 일간 파이프라인 — Phase 2 버전 (로드맵 1.6~1.11, 2.1~2.7).
 *
 * Trigger.dev 에 의존하지 않는다. 태스크는 이 함수를 부르기만 한다 (CLAUDE.md §3).
 *
 * 흐름:
 *   수집 → 저비용 필터 → 후보 선별 → pending 기록
 *        → 그룹핑 → 1차 채점 → 근접 재채점 → 선정
 *        → placeholder 기사 → run_topics 기록 → processed 갱신 → 정리
 *
 * placeholder 는 3.15 에서 실제 조사·작성 파이프라인으로 교체한다.
 */

export interface DailyRunResult {
  runId: string;
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
  published: number;
  costFixed: number;
  failures: FeedFailure[];
  cleaned: { pendingDeleted: number; processedDeleted: number };
}

export interface DailyRunOptions {
  onWarn?: (message: string, data: Record<string, unknown>) => void;
  onInfo?: (message: string, data: Record<string, unknown>) => void;
}

/** 토픽을 촉발한 항목의 URL. 재채점이 이 페이지를 가져온다 */
function triggerUrl(topic: Topic): string {
  return topic.items[0]?.url ?? '';
}

export async function runDailyDiscovery(
  db: ServiceClient,
  claude: AnthropicClient,
  options: DailyRunOptions = {},
): Promise<DailyRunResult> {
  const runId = await startRun(db, 'daily');
  const warn = options.onWarn ?? (() => {});
  const info = options.onInfo ?? (() => {});

  try {
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
    if (grouping.usedFallback) {
      warn('그룹핑 폴백', { reason: grouping.fallbackReason ?? '' });
    }
    const topics = grouping.topics;

    // ── 1차 채점 (2.4) ──────────────────────────────────────
    const recentById = new Map(recent.map((r) => [r.id, r.title]));
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
    const forRescore = selectForRescore(scoring.scored);
    const rescore = await rescoreTopics(
      claude,
      createFetchContext(),
      forRescore.map((score) => ({
        score,
        title: topics[score.index]!.title,
        triggerUrl: triggerUrl(topics[score.index]!),
        followUpOfTitle: topics[score.index]!.followUpOfArticleId
          ? (recentById.get(topics[score.index]!.followUpOfArticleId!) ?? null)
          : null,
      })),
    );

    // 재채점 결과를 1차 점수 위에 덮는다
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

    // ── 선정 (2.6) ──────────────────────────────────────────
    const scoredList = [...finalScores.values()].sort((a, b) => a.index - b.index);
    const { selected, entries } = selectTopics(scoredList);
    const selection = summarizeSelection(entries);

    // ── placeholder 기사 (1.9, 3.15 에서 제거) ──────────────
    const selectedTopics = selected.map((s) => topics[s.index]!);
    const published = await insertPlaceholders(
      db,
      selectedTopics.map((t) => makePlaceholder(t.items[0]!)),
      runId,
    );

    // ── 판정 기록 (2.7) ─────────────────────────────────────
    const entryByIndex = new Map(entries.map((e) => [e.score.index, e]));
    const rows: RunTopicRow[] = topics.map((topic, index) => {
      const score = finalScores.get(index) ?? null;
      const entry = entryByIndex.get(index) ?? null;
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
        reason_novelty: score?.novelty.reason ?? null,
        reason_impact: score?.impact.reason ?? null,
        reason_interest: score?.interest.reason ?? null,
        rescored: firstPassTotals.has(index),
        first_pass_score: firstPassTotals.get(index) ?? null,
        rescore_skip_reason: rescoreSkips.get(index) ?? null,
        selected: entry?.selected ?? false,
        // 채점을 못 받은 토픽도 사유를 남긴다. 조용히 비어 있으면 원인을 못 찾는다
        reject_reason: entry ? entry.reason : 'unscored',
        rank: entry?.rank ?? null,
        article_id: null,
      };
    });
    await insertRunTopics(db, runId, rows);

    // ── 마무리 ──────────────────────────────────────────────
    // 선정 단계가 정상 종료된 뒤에만 processed 로 넘긴다 (D-01).
    // 탈락한 후보도 processed 다
    await markProcessed(db, candidates.map((i) => i.urlHash));
    const cleaned = await cleanupSeenItems(db);

    // 고정비: 발굴~선정. 기사가 0건인 날에도 발생한다 (D-07)
    const haikuUsage: TokenUsage = addUsage(
      addUsage(grouping.usage, scoring.usage),
      rescore.usage,
    );
    const costFixed = estimateCost(haikuUsage, PRICING[models.score], {
      cacheRead: CACHE_READ_MULTIPLIER,
      cacheWrite: CACHE_WRITE_MULTIPLIER,
    });

    await finishRun(db, runId, 'success', {
      topics_seen: topics.length,
      topics_selected: selected.length,
      articles_published: published,
      cost_pages_fetched: rescore.pagesFetched,
      cost_input_tokens: haikuUsage.inputTokens,
      cost_output_tokens: haikuUsage.outputTokens,
      cost_cached_tokens: haikuUsage.cacheReadTokens,
      cost_fixed: Number(costFixed.toFixed(4)),
      cost_variable: 0,
      notes:
        `수집 ${unique.length} → 필터통과 ${kept.length} → 후보 ${candidates.length} → ` +
        `토픽 ${topics.length} → 통과 ${selection.passedThreshold} → 선정 ${selected.length}. ` +
        `피드실패 ${failures.length}, 재채점 ${rescore.pagesFetched}`,
    });

    return {
      runId,
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
      published,
      costFixed: Number(costFixed.toFixed(4)),
      failures,
      cleaned,
    };
  } catch (error) {
    // 실패해도 런 기록은 남긴다. pending 항목은 그대로여서 다음 날 재처리된다
    await finishRun(db, runId, 'failed', {
      notes: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
