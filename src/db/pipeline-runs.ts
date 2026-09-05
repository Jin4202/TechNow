import type { ServiceClient } from '@/db/supabase/service';

/**
 * pipeline_runs 저장소 (로드맵 1.10).
 *
 * Trigger.dev 무료 티어는 로그를 하루만 보관한다. 기록의 원본은 로그가 아니라
 * 이 테이블이다 (MASTER_PLAN §4).
 */

export interface RunCounts {
  topics_seen?: number;
  topics_selected?: number;
  articles_published?: number;
  cost_search_calls?: number;
  cost_pages_fetched?: number;
  cost_images?: number;
  cost_input_tokens?: number;
  cost_output_tokens?: number;
  cost_cached_tokens?: number;
  /** 발굴~선정. 기사가 0개인 날에도 발생한다 (D-07) */
  cost_fixed?: number;
  /** 조사~이미지. 기사별로 쌓인다 (D-07) */
  cost_variable?: number;
  notes?: string;
}

export async function startRun(
  db: ServiceClient,
  runType: 'daily' | 'monthly',
): Promise<string> {
  const { data, error } = await db
    .from('pipeline_runs')
    .insert({ run_type: runType })
    .select('id')
    .single();

  if (error) throw new Error(`pipeline_runs 생성 실패: ${error.message}`);
  return data.id;
}

export async function finishRun(
  db: ServiceClient,
  runId: string,
  status: 'success' | 'failed',
  counts: RunCounts = {},
): Promise<void> {
  const { error } = await db
    .from('pipeline_runs')
    .update({ ...counts, status, finished_at: new Date().toISOString() })
    .eq('id', runId);

  if (error) throw new Error(`pipeline_runs 갱신 실패: ${error.message}`);
}

export interface RunCostRow {
  id: string;
  startedAt: string;
  status: string;
  articlesBuilt: number;
  searchCalls: number;
  pagesFetched: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costFixed: number;
  costVariable: number;
}

/**
 * 최근 런의 비용을 읽는다 (로드맵 3.16).
 *
 * 기록만 해 두고 읽는 길이 없으면 없는 것과 같다. 월 결산(Phase 7)이 오기 전에도
 * 하루 단위로 확인할 수 있어야 프롬프트 변경이 비용에 준 영향을 알 수 있다.
 */
export async function recentRunCosts(db: ServiceClient, limit = 30): Promise<RunCostRow[]> {
  const { data, error } = await db
    .from('pipeline_runs')
    // 한 줄로 둔다. 문자열을 이으면 supabase-js 가 컬럼 타입을 추론하지 못한다
    // prettier-ignore
    .select('id, started_at, status, topics_selected, cost_search_calls, cost_pages_fetched, cost_input_tokens, cost_output_tokens, cost_cached_tokens, cost_fixed, cost_variable')
    .eq('run_type', 'daily')
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`pipeline_runs 조회 실패: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    status: r.status,
    articlesBuilt: r.topics_selected ?? 0,
    searchCalls: r.cost_search_calls ?? 0,
    pagesFetched: r.cost_pages_fetched ?? 0,
    inputTokens: r.cost_input_tokens ?? 0,
    outputTokens: r.cost_output_tokens ?? 0,
    cachedTokens: r.cost_cached_tokens ?? 0,
    costFixed: Number(r.cost_fixed ?? 0),
    costVariable: Number(r.cost_variable ?? 0),
  }));
}
