import type { Category } from '@/config/categories';
import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 발행된 기사 조회 (앱용).
 *
 * anon 키 + RLS 로 동작한다. `status = 'published'` 필터는 RLS 정책이 이미
 * 걸고 있지만(D-02), 쿼리에도 명시해 의도를 드러내고 인덱스를 타게 한다.
 */

export interface ArticleListItem {
  id: string;
  slug: string;
  category: Category;
  title: string;
  one_line_summary: string;
  cover_image_url: string | null;
  published_at: string | null;
}

export async function listPublishedArticles(
  db: SupabaseClient<Database>,
  limit = 30,
): Promise<ArticleListItem[]> {
  const { data, error } = await db
    .from('articles')
    .select('id, slug, category, title, one_line_summary, cover_image_url, published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`기사 목록 조회 실패: ${error.message}`);
  return data ?? [];
}
