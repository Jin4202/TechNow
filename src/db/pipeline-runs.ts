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
