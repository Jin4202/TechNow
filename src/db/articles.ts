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

/**
 * 최근 발행 기사 제목 (로드맵 2.3).
 *
 * 그룹핑 프롬프트에 넣어 follow-up 을 판정한다.
 * 기간은 thresholds.followUpWindowDays.
 */
export async function recentPublishedArticles(
  db: ServiceClient,
  days: number,
): Promise<{ id: string; title: string }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('articles')
    .select('id, title')
    .eq('status', 'published')
    .gte('published_at', since)
    .order('published_at', { ascending: false });

  if (error) throw new Error(`최근 발행 기사 조회 실패: ${error.message}`);
  return data ?? [];
}
