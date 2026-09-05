import { feeds } from '@/config/feeds';
import { thresholds } from '@/config/thresholds';
import { insertPlaceholders } from '@/db/articles';
import { finishRun, startRun } from '@/db/pipeline-runs';
import {
  cleanupSeenItems,
  getSeenRows,
  insertPending,
  markProcessed,
} from '@/db/seen-feed-items';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { makePlaceholder } from '@/pipeline/discover/make-placeholder';
import { partitionCandidates } from '@/pipeline/discover/partition-candidates';

import type { ServiceClient } from '@/db/supabase/service';
import type { FeedFailure } from '@/pipeline/discover/fetch-feeds';

/**
 * 일간 파이프라인 — Phase 1 버전 (로드맵 1.6~1.10).
 *
 * Trigger.dev 에 의존하지 않는다. 태스크는 이 함수를 부르기만 한다 (CLAUDE.md §3).
 * 덕분에 로컬 DB 만으로 전체 흐름을 검증할 수 있다.
 *
 * 현재 흐름:
 *   피드 수집 → 후보 선별 → pending 기록 → placeholder → processed 갱신 → 정리
 *
 * Phase 2에서 그룹핑·채점·선정이 "후보 선별"과 "placeholder" 사이에 들어가고,
 * 3.15 에서 placeholder 경로가 제거된다.
 */

export interface DailyRunResult {
  runId: string;
  uniqueItems: number;
  candidates: number;
  newlyRecorded: number;
  resumed: number;
  skipped: number;
  published: number;
  failures: FeedFailure[];
  cleaned: { pendingDeleted: number; processedDeleted: number };
}

export interface DailyRunOptions {
  /** 로그 훅. Trigger.dev logger 나 console 을 넣는다 */
  onWarn?: (message: string, data: Record<string, unknown>) => void;
}

export async function runDailyDiscovery(
  db: ServiceClient,
  options: DailyRunOptions = {},
): Promise<DailyRunResult> {
  const runId = await startRun(db, 'daily');

  try {
    const { items, failures } = await fetchFeeds(feeds);
    const unique = dedupeItems(items);

    // 실패한 피드는 그날 건너뛰고 로그에만 남긴다 (기획서 §2.1)
    for (const failure of failures) options.onWarn?.('피드 수집 실패', { ...failure });

    // D-01: processed 는 제외, pending 은 다시 후보
    const seen = await getSeenRows(
      db,
      unique.map((i) => i.urlHash),
    );
    const { candidates, toInsert, resumedCount, skippedCount } = partitionCandidates(unique, seen);

    await insertPending(db, toInsert, runId);

    // Phase 2가 붙기 전까지는 상위 몇 개만 placeholder 로 만든다.
    // 후보 전체(150건)를 기사로 만들면 목록 페이지가 쓰레기로 찬다
    const selected = candidates.slice(0, thresholds.dailyCap);
    const published = await insertPlaceholders(
      db,
      selected.map((item) => makePlaceholder(item)),
      runId,
    );

    // 선정 단계가 정상 종료된 뒤에만 processed 로 넘긴다 (D-01).
    // 탈락한 후보도 processed 다 — 매일 재채점하면 고정비만 든다
    await markProcessed(
      db,
      candidates.map((i) => i.urlHash),
    );

    const cleaned = await cleanupSeenItems(db);

    await finishRun(db, runId, 'success', {
      topics_seen: candidates.length,
      topics_selected: selected.length,
      articles_published: published,
      notes:
        `피드 ${feeds.length}개 중 ${failures.length}개 실패, 수집 ${unique.length}건, ` +
        `재개 ${resumedCount}건, 기처리 ${skippedCount}건`,
    });

    return {
      runId,
      uniqueItems: unique.length,
      candidates: candidates.length,
      newlyRecorded: toInsert.length,
      resumed: resumedCount,
      skipped: skippedCount,
      published,
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
