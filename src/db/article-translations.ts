import type { Locale } from '@/config/locales';
import type { ServiceClient } from '@/db/supabase/service';
import type { ArticleSection } from '@/pipeline/write/write-article';

/**
 * 번역본 저장·조회 (로드맵 4.4).
 *
 * 파이프라인 전용이라 service 클라이언트를 받는다. 앱이 읽는 경로는
 * `src/db/published-articles.ts` 이고 그쪽은 anon 키 + RLS 로 간다.
 */

export interface TranslationToInsert {
  articleId: string;
  locale: Locale;
  title: string;
  oneLineSummary: string;
  /**
   * 원문과 같은 구조 (D-03).
   *
   * 이름 붙인 인터페이스가 아니라 구조 타입으로 쓴다 — supabase-js 의 Json 타입은
   * 인덱스 시그니처를 요구해서 named interface 를 받지 않는다 (articles.ts 도 같다)
   */
  body: { sections: { heading: string; paragraphs: string[]; sources: number[] }[] };
}

/**
 * 번역본을 넣는다.
 *
 * `(article_id, locale)` 유니크 제약에 걸리는 것은 재시도로 인한 중복이다 —
 * 실패가 아니라 이미 있다는 뜻이므로 조용히 넘어간다 (기사 저장과 같은 규칙).
 */
export async function insertTranslation(
  db: ServiceClient,
  translation: TranslationToInsert,
): Promise<'inserted' | 'already-exists'> {
  const { error } = await db.from('article_translations').insert({
    article_id: translation.articleId,
    locale: translation.locale,
    title: translation.title,
    one_line_summary: translation.oneLineSummary,
    body: translation.body,
  });

  if (error) {
    if (error.code === '23505') return 'already-exists';
    throw new Error(`번역본 저장 실패: ${error.message}`);
  }

  return 'inserted';
}

export interface PendingArticle {
  id: string;
  title: string;
  oneLineSummary: string;
  sections: ArticleSection[];
  /** 이미 있는 번역본의 언어 */
  locales: Locale[];
  /** 이미 있는 커버 이미지 */
  coverImageUrl: string | null;
}

/**
 * 자산이 덜 갖춰져 발행을 기다리는 기사 (4.4 의 스윕).
 *
 * `ready_pending` 은 "본문은 있는데 필수 자산이 빠졌다" 는 뜻이다. 이 런에서
 * 방금 만든 기사와 **이전 런에서 실패해 남은 기사**가 함께 잡힌다 — 후자를
 * 다시 시도하는 것이 이 함수의 목적이다 (기획서 §2.3 의 "다음 런에서 재시도").
 *
 * 발행은 별도 스케줄이 하고(D-04), 2회 연속 대기하면 `failed` 가 된다.
 * 그래서 여기에 시간 조건을 두지 않는다 — 남아 있는 것은 아직 기회가 있는 기사뿐이다.
 *
 * 기본 상한 10 은 넉넉한 값이다. 하루 상한이 3이고 2회 대기 후 `failed` 이므로
 * 대기열은 6건을 넘을 수 없다. 상한이 있는 이유는 이 스윕이 부모 태스크 안에서
 * 돌기 때문이다 — 큐가 예상 밖으로 길어져도 런의 시간 예산을 다 먹지 않게 한다.
 */
export async function articlesAwaitingAssets(
  db: ServiceClient,
  limit = 10,
): Promise<PendingArticle[]> {
  const { data, error } = await db
    .from('articles')
    .select('id, title, one_line_summary, body, cover_image_url, article_translations(locale)')
    .eq('status', 'ready_pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(`대기 기사 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    oneLineSummary: row.one_line_summary,
    sections: (row.body as unknown as { sections: ArticleSection[] }).sections,
    locales: row.article_translations.map((t) => t.locale),
    coverImageUrl: row.cover_image_url,
  }));
}

/**
 * 자산이 다 모인 기사를 발행 대기로 올린다.
 *
 * `ready_pending` 인 행만 건드린다. 이미 발행된 기사를 되돌리는 경로를
 * 만들지 않기 위해서다 (CLAUDE.md §2.2 — 발행된 기사는 수정하지 않는다).
 */
export async function saveCoverImageUrl(
  db: ServiceClient,
  articleId: string,
  url: string,
): Promise<void> {
  // 발행 전 기사에만 붙인다. 발행된 기사는 수정하지 않는다 (CLAUDE.md §2.2)
  const { error } = await db
    .from('articles')
    .update({ cover_image_url: url })
    .eq('id', articleId)
    .neq('status', 'published');

  if (error) throw new Error(`커버 이미지 저장 실패: ${error.message}`);
}

export async function markArticleReady(db: ServiceClient, articleId: string): Promise<boolean> {
  const { data, error } = await db
    .from('articles')
    .update({ status: 'ready' })
    .eq('id', articleId)
    .eq('status', 'ready_pending')
    .select('id');

  if (error) throw new Error(`발행 대기 승격 실패: ${error.message}`);
  return (data ?? []).length > 0;
}
