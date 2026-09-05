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

export interface ArticleSource {
  ordinal: number;
  url: string;
  title: string | null;
  publisher: string | null;
  tier: number;
}

export interface ArticleSection {
  heading: string;
  paragraphs: string[];
  sources: number[];
}

export interface ArticleDetail extends ArticleListItem {
  body: { sections: ArticleSection[] };
  tags: string[];
  style_guide_version: string | null;
  sources: ArticleSource[];
  /** 이 기사가 후속으로 다룬 이전 기사 */
  followUpOf: { slug: string; title: string } | null;
  /** 이 기사를 후속으로 다룬 이후 기사들 */
  followedBy: { slug: string; title: string }[];
}

/**
 * 발행된 기사 하나 (로드맵 3.14).
 *
 * RLS 가 published 만 돌려주므로 draft 를 slug 로 찔러봐도 없는 것과 구분되지 않는다.
 * 출처와 follow-up 링크를 함께 가져온다 — 상세 페이지가 그것을 다 보여줘야 한다.
 */
export async function getPublishedArticle(
  db: SupabaseClient<Database>,
  slug: string,
): Promise<ArticleDetail | null> {
  const { data, error } = await db
    .from('articles')
    .select(
      'id, slug, category, title, one_line_summary, cover_image_url, published_at, body, tags, style_guide_version, follow_up_of',
    )
    .eq('slug', slug)
    .eq('status', 'published')
    .maybeSingle();

  if (error) throw new Error(`기사 조회 실패: ${error.message}`);
  if (!data) return null;

  const [sourcesResult, followUpOfResult, followedByResult] = await Promise.all([
    db
      .from('article_sources')
      .select('ordinal, url, title, publisher, tier')
      .eq('article_id', data.id)
      .order('ordinal', { ascending: true }),
    data.follow_up_of
      ? db
          .from('articles')
          .select('slug, title')
          .eq('id', data.follow_up_of)
          .eq('status', 'published')
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db
      .from('articles')
      .select('slug, title')
      .eq('follow_up_of', data.id)
      .eq('status', 'published')
      .order('published_at', { ascending: true }),
  ]);

  if (sourcesResult.error) throw new Error(`출처 조회 실패: ${sourcesResult.error.message}`);

  return {
    id: data.id,
    slug: data.slug,
    category: data.category,
    title: data.title,
    one_line_summary: data.one_line_summary,
    cover_image_url: data.cover_image_url,
    published_at: data.published_at,
    body: data.body as unknown as { sections: ArticleSection[] },
    tags: data.tags,
    style_guide_version: data.style_guide_version,
    sources: sourcesResult.data ?? [],
    followUpOf: followUpOfResult.data ?? null,
    followedBy: followedByResult.data ?? [],
  };
}

/** 정적 생성과 사이트맵용 */
export async function listPublishedSlugs(db: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await db.from('articles').select('slug').eq('status', 'published');
  if (error) throw new Error(`슬러그 조회 실패: ${error.message}`);
  return (data ?? []).map((a) => a.slug);
}
