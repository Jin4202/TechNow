import type { Locale } from '@/config/locales';
import type { ArticleListItem } from '@/db/published-articles';
import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 스크랩 (로드맵 6.1, 6.2).
 *
 * anon 키 + RLS 로 동작한다. 정책이 본인 행만 허용하므로
 * `user_id` 를 조건으로 다시 걸지 않는다 — 접근 제어가 두 곳에 있으면
 * 한 곳만 고치게 된다 (`src/db/profiles.ts` 와 같은 규칙).
 *
 * 스크랩에는 로그인이 필요하다 (기획서 §2.7). 기사 읽기와 다른 점이다.
 */

export type ScrapOutcome = 'scrapped' | 'unscrapped' | 'not-logged-in' | 'not-found';

/**
 * 스크랩을 켜고 끈다.
 *
 * 같은 버튼이 두 방향을 다 한다 — 독자가 보는 것은 "저장됨" 하나뿐이고,
 * 상태를 먼저 읽고 나서 쓰면 그 사이에 다른 탭이 바꿀 수 있다.
 * 넣어 보고 유니크 제약에 걸리면 지운다.
 */
export async function toggleScrap(
  db: SupabaseClient<Database>,
  articleId: string,
): Promise<ScrapOutcome> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return 'not-logged-in';

  const { error } = await db.from('scraps').insert({ user_id: user.id, article_id: articleId });

  if (!error) return 'scrapped';

  // 23505 = 이미 스크랩했다. 해제로 읽는다
  if (error.code === '23505') {
    const { error: deleteError } = await db
      .from('scraps')
      .delete()
      .eq('user_id', user.id)
      .eq('article_id', articleId);

    if (deleteError) throw new Error(`스크랩 해제 실패: ${deleteError.message}`);
    return 'unscrapped';
  }

  // 23503 = 없는 기사. 발행 전 기사를 id 로 찔러본 경우도 여기 걸린다
  if (error.code === '23503') return 'not-found';

  throw new Error(`스크랩 실패: ${error.message}`);
}

/**
 * 이 기사를 이미 스크랩했나 (상세 페이지의 버튼 상태).
 *
 * **로그인한 사용자만 부를 수 있다.** `userId` 를 인자로 받는 이유가 그것이다 —
 * `scraps` 는 anon 에게 권한이 없어서 세션 없이 부르면 permission denied 로
 * 기사 화면이 통째로 죽는다. 타입이 그 실수를 막게 해 둔다.
 */
export async function isScrapped(
  db: SupabaseClient<Database>,
  articleId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('scraps')
    .select('id')
    .eq('article_id', articleId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`스크랩 조회 실패: ${error.message}`);
  return data !== null;
}

export interface ScrappedArticle extends ArticleListItem {
  scrappedAt: string;
}

/**
 * 스크랩한 기사 목록 (6.2).
 *
 * 스크랩한 순서로 돌려준다 — 폴더는 "내가 모은 것" 이지 "최신 뉴스" 가 아니다.
 * 발행이 취소된 기사(`unpublished`)는 RLS 가 걸러내므로 목록에서 사라진다.
 */
export async function listScraps(
  db: SupabaseClient<Database>,
  locale: Locale,
  limit = 100,
): Promise<ScrappedArticle[]> {
  const { data, error } = await db
    .from('scraps')
    .select(
      'scraped_at, articles!inner(id, slug, category, title, one_line_summary, cover_image_url, published_at, status, article_translations(locale, title, one_line_summary))',
    )
    .eq('articles.status', 'published')
    .order('scraped_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`스크랩 목록 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => {
    const article = row.articles;
    // 번역이 없으면 영문으로 보여준다. 목록에서 기사가 통째로 사라지는 것보다
    // 낫다 — 사용자가 직접 담은 것이고, 없어지면 사라진 이유를 알 수 없다 (D-35 의 예외)
    const translation = article.article_translations.find((t) => t.locale === locale);

    return {
      id: article.id,
      slug: article.slug,
      category: article.category,
      title: translation?.title ?? article.title,
      one_line_summary: translation?.one_line_summary ?? article.one_line_summary,
      cover_image_url: article.cover_image_url,
      published_at: article.published_at,
      scrappedAt: row.scraped_at,
    };
  });
}
