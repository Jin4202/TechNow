import { DEFAULT_LOCALE } from '@/config/locales';

import type { Category } from '@/config/categories';
import type { Locale } from '@/config/locales';
import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 발행된 기사 조회 (앱용, 로드맵 4.5).
 *
 * anon 키 + RLS 로 동작한다. `status = 'published'` 필터는 RLS 정책이 이미
 * 걸고 있지만(D-02), 쿼리에도 명시해 의도를 드러내고 인덱스를 타게 한다.
 *
 * **번역이 없는 기사는 그 언어에서 보이지 않는다.** 영어는 원본이라 늘 있고,
 * 한국어는 `article_translations` 에 행이 있을 때만 나온다 — 없는 기사를 영어로
 * 대신 보여주면 언어를 바꿔도 안 바뀌는 반쪽 상태가 된다 (CLAUDE.md §5).
 * 4.6 이후 새 기사는 번역 없이는 발행되지 않으므로, 이 조건에 걸리는 것은
 * Phase 4 이전에 발행된 기사뿐이다.
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

/** 목록 좁히기 (7.3, 7.8). 없으면 전체 */
export interface ArticleFilter {
  category?: Category;
  tag?: string;
  /** `YYYY-MM`. 그달 1일 00:00 PT ~ 다음달 1일 00:00 PT (7.8) */
  month?: string;
  limit?: number;
}

/**
 * 발행 기준 시간대.
 *
 * 발행이 07:00 America/Los_Angeles 로 돈다 (D-04). 독자가 보는 "9월 기사" 는
 * 그 리듬을 따라야 한다 — UTC 로 자르면 PT 로 8월 31일 저녁에 발행된 기사가
 * 9월로 넘어간다.
 */
const PUBLISH_TIME_ZONE = 'America/Los_Angeles';

/**
 * `YYYY-MM` 을 UTC 구간으로 바꾼다. 형식이 아니면 `null`.
 *
 * `src/db/monthly-scraps.ts` 에도 `monthRange` 가 있지만 **그쪽은 UTC 다.**
 * 월간 요약은 사용자별 집계라 표시용 달과 목적이 다르다. 같은 이름의 다른 규칙을
 * 한 함수로 합치면 나중에 둘 중 하나가 조용히 틀린다.
 */
export function publishMonthRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;

  return {
    from: startOfMonthUtc(year, monthIndex),
    to: startOfMonthUtc(year, monthIndex + 1),
  };
}

/**
 * 그 달 1일 00:00 (PT) 를 UTC ISO 로.
 *
 * PT 는 서머타임에 따라 UTC-7 / UTC-8 로 오간다. 오프셋을 상수로 박으면
 * 3월과 11월 경계가 한 시간씩 틀린다 — `Intl` 이 그 달의 실제 오프셋을 알고 있으므로
 * 그것으로 역산한다.
 */
function startOfMonthUtc(year: number, monthIndex: number): string {
  const naive = Date.UTC(year + Math.floor(monthIndex / 12), monthIndex % 12, 1, 0, 0, 0);

  // naive 를 PT 로 읽었을 때 몇 시인지 보고, 그 차이만큼 되돌린다
  const asPt = new Date(
    new Date(naive).toLocaleString('en-US', { timeZone: PUBLISH_TIME_ZONE }),
  ).getTime();
  const asUtc = new Date(new Date(naive).toLocaleString('en-US', { timeZone: 'UTC' })).getTime();

  return new Date(naive + (asUtc - asPt)).toISOString();
}

export async function listPublishedArticles(
  db: SupabaseClient<Database>,
  locale: Locale = DEFAULT_LOCALE,
  filter: ArticleFilter = {},
): Promise<ArticleListItem[]> {
  const limit = filter.limit ?? 30;

  if (locale === DEFAULT_LOCALE) {
    let query = db
      .from('articles')
      .select('id, slug, category, title, one_line_summary, cover_image_url, published_at')
      .eq('status', 'published');

    query = applyFilter(query, filter);

    const { data, error } = await query
      .order('published_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`기사 목록 조회 실패: ${error.message}`);
    return data ?? [];
  }

  // `!inner` 라서 번역이 없는 기사는 결과에서 빠진다
  let query = db
    .from('articles')
    .select(
      'id, slug, category, cover_image_url, published_at, article_translations!inner(title, one_line_summary, locale)',
    )
    .eq('status', 'published')
    .eq('article_translations.locale', locale);

  query = applyFilter(query, filter);

  const { data, error } = await query
    .order('published_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`기사 목록 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    category: row.category,
    title: row.article_translations[0]!.title,
    one_line_summary: row.article_translations[0]!.one_line_summary,
    cover_image_url: row.cover_image_url,
    published_at: row.published_at,
  }));
}

/**
 * 필터를 건다 (7.3).
 *
 * 태그는 배열 컬럼이라 `contains` 를 쓴다. 카테고리는 인덱스가 있다
 * (`articles_category_idx`) — 처음부터 이 필터를 예상하고 만든 인덱스다.
 *
 * 제네릭인 이유: 영문 질의와 번역 조인 질의의 반환 타입이 달라서
 * 하나로 좁히면 supabase-js 의 타입 추론이 무너진다
 */
function applyFilter<T>(query: T, filter: ArticleFilter): T {
  let next = query as T & {
    eq: (column: string, value: string) => T;
    contains: (column: string, value: string[]) => T;
    gte: (column: string, value: string) => T;
    lt: (column: string, value: string) => T;
  };

  if (filter.category) next = next.eq('category', filter.category) as typeof next;
  if (filter.tag) next = next.contains('tags', [filter.tag]) as typeof next;

  if (filter.month) {
    const range = publishMonthRange(filter.month);
    // 형식이 틀리면 조건을 걸지 않는다. 부르는 쪽(아카이브 페이지)이 이미
    // 형식을 검사해 404 를 내므로, 여기까지 온 잘못된 값은 없어야 한다
    if (range) {
      next = next.gte('published_at', range.from) as typeof next;
      next = next.lt('published_at', range.to) as typeof next;
    }
  }

  return next as T;
}

export interface ArchiveMonth {
  /** `YYYY-MM` */
  month: string;
  articleCount: number;
}

/**
 * 기사가 있는 달 목록 (7.8).
 *
 * 집계는 DB 함수가 한다 — PostgREST 는 group by 를 못 한다.
 * 함수가 security definer 가 **아니므로** RLS 가 그대로 걸려 발행된 기사만 세어진다.
 */
export async function listArchiveMonths(
  db: SupabaseClient<Database>,
): Promise<ArchiveMonth[]> {
  const { data, error } = await db.rpc('article_months');

  if (error) throw new Error(`아카이브 월 목록 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    // 함수는 date 를 돌려준다 (YYYY-MM-DD). 표시·링크에는 YYYY-MM 만 쓴다
    month: String(row.month).slice(0, 7),
    articleCount: Number(row.article_count),
  }));
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
  locale: Locale = DEFAULT_LOCALE,
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

  // 번역이 없으면 그 언어에는 이 기사가 없다. 영어로 대신 보여주지 않는다
  const translation = locale === DEFAULT_LOCALE ? null : await getTranslation(db, data.id, locale);
  if (locale !== DEFAULT_LOCALE && !translation) return null;

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
    title: translation?.title ?? data.title,
    one_line_summary: translation?.one_line_summary ?? data.one_line_summary,
    cover_image_url: data.cover_image_url,
    published_at: data.published_at,
    // 본문도 번역본으로 바꾼다. 구조는 원문과 같음이 보장돼 있다 (4.3a, D-03)
    body: (translation?.body ?? data.body) as unknown as { sections: ArticleSection[] },
    tags: data.tags,
    style_guide_version: data.style_guide_version,
    sources: sourcesResult.data ?? [],
    followUpOf: followUpOfResult.data ?? null,
    followedBy: followedByResult.data ?? [],
  };
}

/**
 * 기사 하나의 번역본.
 *
 * follow-up 링크의 제목은 번역하지 않는다 — 목록에 두 줄 나오는 링크 제목까지
 * 언어별로 조인하면 쿼리가 세 배가 된다. 4.5 의 완료 기준은 "기사 내용" 이다.
 */
async function getTranslation(db: SupabaseClient<Database>, articleId: string, locale: Locale) {
  const { data, error } = await db
    .from('article_translations')
    .select('title, one_line_summary, body')
    .eq('article_id', articleId)
    .eq('locale', locale)
    .maybeSingle();

  if (error) throw new Error(`번역본 조회 실패: ${error.message}`);
  return data;
}

/**
 * 이 기사가 존재하는 언어 (4.5).
 *
 * hreflang 은 **실제로 있는 언어만** 가리켜야 한다 (D-08). 번역이 없는데
 * 대체 언어판이 있다고 알리면 검색엔진이 404 를 받는다.
 * 영어는 원본이라 언제나 있다.
 */
export async function availableLocales(
  db: SupabaseClient<Database>,
  articleId: string,
): Promise<Locale[]> {
  const { data, error } = await db
    .from('article_translations')
    .select('locale')
    .eq('article_id', articleId);

  if (error) throw new Error(`번역 언어 조회 실패: ${error.message}`);
  return [DEFAULT_LOCALE, ...(data ?? []).map((row) => row.locale)];
}

/** 정적 생성과 사이트맵용 */
export async function listPublishedSlugs(db: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await db.from('articles').select('slug').eq('status', 'published');
  if (error) throw new Error(`슬러그 조회 실패: ${error.message}`);
  return (data ?? []).map((a) => a.slug);
}
