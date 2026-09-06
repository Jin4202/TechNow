import type { ServiceClient } from '@/db/supabase/service';

/**
 * run_topics 저장소 (로드맵 2.7).
 *
 * 런마다 전 토픽의 판정을 남긴다. 캘리브레이션(2.8)이 여기를 읽는다 —
 * 로그만 보고 "이 토픽이 왜 떨어졌나"에 답할 수 있어야 한다.
 */

export interface RunTopicRow {
  topic_title: string;
  item_count: number;
  feed_names: string[];
  trigger_url: string | null;
  follow_up_of: string | null;
  score_novelty: number | null;
  score_impact: number | null;
  score_interest: number | null;
  importance_score: number | null;
  reason_novelty: string | null;
  reason_impact: string | null;
  reason_interest: string | null;
  rescored: boolean;
  first_pass_score: number | null;
  rescore_skip_reason: string | null;
  selected: boolean;
  reject_reason: string | null;
  rank: number | null;
  article_id: string | null;
  /** 기사 생성 실패 종류. 선정됐지만 기사가 안 나온 경우에만 */
  build_failure: string | null;
  /** 실패 상세. "근거 없음 1건" 처럼 무엇이 몇 건인지 */
  build_detail: string | null;
}

export async function insertRunTopics(
  db: ServiceClient,
  runId: string,
  rows: readonly RunTopicRow[],
): Promise<number> {
  if (rows.length === 0) return 0;

  // 130여 행이라 한 번에 넣어도 되지만, 나중에 피드가 늘어도 안전하도록 나눈다
  const CHUNK = 200;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error, count } = await db
      .from('run_topics')
      .insert(
        rows.slice(i, i + CHUNK).map((row) => ({ ...row, run_id: runId })),
        { count: 'exact' },
      );

    if (error) throw new Error(`run_topics 기록 실패: ${error.message}`);
    inserted += count ?? 0;
  }

  return inserted;
}

/** 캘리브레이션용 — 기간 내 점수 분포 */
export async function scoreHistogram(
  db: ServiceClient,
  sinceIso: string,
): Promise<Record<number, number>> {
  const { data, error } = await db
    .from('run_topics')
    .select('importance_score')
    .gte('created_at', sinceIso)
    .not('importance_score', 'is', null);

  if (error) throw new Error(`점수 분포 조회 실패: ${error.message}`);

  const histogram: Record<number, number> = {};
  for (const row of data ?? []) {
    const score = row.importance_score;
    if (score !== null) histogram[score] = (histogram[score] ?? 0) + 1;
  }
  return histogram;
}
