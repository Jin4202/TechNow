import { budget } from '@/config/budget';

import type { ServiceClient } from '@/db/supabase/service';
import type { CollectedSource } from '@/pipeline/research/research-topic';

/**
 * source_texts 저장소 (D-05).
 *
 * 조사~검증 단계가 공유하는 **임시** 저장소다. 가져온 페이지 전문을 영구 보관하지
 * 않는다는 원칙(기획서 §4)을 `expires_at` + 정리 태스크로 지킨다.
 *
 * 태스크 페이로드로 본문을 넘기지 않는 이유: 출처 5개면 수십 KB 라
 * Trigger.dev 페이로드로는 크고, 자식 태스크가 재시도될 때마다 다시 실려야 한다.
 */

export interface StoredSource extends CollectedSource {
  ordinal: number;
}

export async function insertSourceTexts(
  db: ServiceClient,
  runId: string,
  topicHash: string,
  sources: readonly StoredSource[],
): Promise<number> {
  if (sources.length === 0) return 0;

  const expiresAt = new Date(
    Date.now() + budget.sourceTextTtlDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await db
    .from('source_texts')
    .insert(
      sources.map((source) => ({
        run_id: runId,
        topic_hash: topicHash,
        url: source.url,
        extracted_text: source.text,
        expires_at: expiresAt,
      })),
    )
    .select('id');

  if (error) throw new Error(`source_texts 저장 실패: ${error.message}`);
  return data?.length ?? 0;
}

/** 자식 태스크가 재시도될 때 이미 모은 출처를 다시 쓴다 */
export async function getSourceTexts(
  db: ServiceClient,
  runId: string,
  topicHash: string,
): Promise<{ url: string; text: string }[]> {
  const { data, error } = await db
    .from('source_texts')
    .select('url, extracted_text')
    .eq('run_id', runId)
    .eq('topic_hash', topicHash)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`source_texts 조회 실패: ${error.message}`);
  return (data ?? []).map((row) => ({ url: row.url, text: row.extracted_text }));
}

/** 만료분 삭제. 매 런 종료 시 부른다 */
export async function cleanupSourceTexts(db: ServiceClient): Promise<number> {
  const { error, count } = await db
    .from('source_texts')
    .delete({ count: 'exact' })
    .lt('expires_at', new Date().toISOString());

  if (error) throw new Error(`source_texts 정리 실패: ${error.message}`);
  return count ?? 0;
}
