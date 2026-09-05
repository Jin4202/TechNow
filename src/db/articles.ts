import type { ServiceClient } from '@/db/supabase/service';
import type { PlaceholderArticle } from '@/pipeline/discover/make-placeholder';

/**
 * articles 저장소.
 *
 * 앱은 이 테이블에 쓰지 않는다. 쓰기는 service_role 을 쓰는 파이프라인 전용이다 (D-02).
 */

/**
 * placeholder 기사를 넣는다 (로드맵 1.9, 3.15에서 제거).
 *
 * (run_id, topic_hash) 유니크 인덱스가 재시도 시 중복 생성을 막는다.
 * slug 충돌도 같은 이유로 무시한다 — 같은 기사가 두 번 온 것이다.
 */
export async function insertPlaceholders(
  db: ServiceClient,
  articles: readonly PlaceholderArticle[],
  runId: string,
): Promise<number> {
  if (articles.length === 0) return 0;

  const { data, error } = await db
    .from('articles')
    .upsert(
      articles.map((a) => ({ ...a, run_id: runId })),
      { onConflict: 'slug', ignoreDuplicates: true },
    )
    .select('id');

  if (error) throw new Error(`placeholder 기사 삽입 실패: ${error.message}`);
  return data?.length ?? 0;
}
