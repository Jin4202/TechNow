import type { Category } from '@/config/categories';
import type { Locale } from '@/config/locales';
import type { ServiceClient } from '@/db/supabase/service';

/**
 * 월간 요약용 집계 (로드맵 6.3).
 *
 * 파이프라인 전용이다 — 매월 1일 스케줄이 **모든 사용자**의 스크랩을 읽어야 하므로
 * service 클라이언트를 쓴다. 앱에서 읽는 경로는 `src/db/scraps.ts` 이고
 * 그쪽은 anon 키 + RLS 로 본인 것만 본다.
 */

export interface ScrappedForSummary {
  articleId: string;
  slug: string;
  category: Category;
  title: string;
  oneLineSummary: string;
  scrappedAt: string;
}

export interface UserMonthScraps {
  userId: string;
  locale: Locale;
  articles: ScrappedForSummary[];
}

/**
 * 한 달의 시작과 다음 달의 시작.
 *
 * 경계를 `>= 이번달 1일` 과 `< 다음달 1일` 로 잡는다. "말일" 을 계산하면
 * 월 길이와 윤년이 끼어들고, 마지막 날 23:59 의 스크랩이 조용히 빠진다.
 *
 * **UTC 기준이다.** 발행은 America/Los_Angeles 를 쓰지만(D-04) 월간 집계는
 * 사용자별 요약이고 시간대별로 경계를 다르게 잡을 근거가 없다. 경계에 걸린
 * 스크랩 한두 건은 다음 달 요약에 들어간다.
 */
export function monthRange(monthStart: string): { from: string; to: string } {
  const start = new Date(`${monthStart}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new Error(`날짜 형식이 잘못됐다: ${monthStart}`);

  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);

  return { from: start.toISOString(), to: next.toISOString() };
}

/** 지난달의 첫날 (YYYY-MM-DD). 매월 1일 스케줄이 이 값을 쓴다 */
export function previousMonthStart(now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return start.toISOString().slice(0, 10);
}

/**
 * 그 달에 스크랩이 있는 사용자별 목록.
 *
 * 스크랩이 없는 사용자는 아예 나오지 않는다 — 기획서 §2.6 은 그런 달에
 * 요약을 만들지 않는다고 했고, 빈 목록을 돌려주면 부르는 쪽이 그것을
 * 다시 걸러야 한다.
 *
 * 언어는 각 사용자의 **현재** 프로필 설정을 따른다 (기획서 §2.6 —
 * "in the user's current language"). 스크랩 시점의 언어가 아니다.
 */
export async function scrapsByUserForMonth(
  db: ServiceClient,
  monthStart: string,
): Promise<UserMonthScraps[]> {
  const { from, to } = monthRange(monthStart);

  const { data, error } = await db
    .from('scraps')
    .select(
      'user_id, scraped_at, articles!inner(id, slug, category, title, one_line_summary, status, article_translations(locale, title, one_line_summary))',
    )
    .eq('articles.status', 'published')
    .gte('scraped_at', from)
    .lt('scraped_at', to)
    .order('scraped_at', { ascending: true });

  if (error) throw new Error(`월간 스크랩 조회 실패: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  // 언어를 먼저 안다. 제목을 어느 쪽으로 넣을지가 언어에 달려 있다.
  // 한 번에 가져온다 — 사용자마다 조회하면 N+1 이다
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: profiles, error: profileError } = await db
    .from('profiles')
    .select('id, locale')
    .in('id', userIds);

  if (profileError) throw new Error(`프로필 조회 실패: ${profileError.message}`);

  const localeById = new Map(profiles?.map((p) => [p.id, p.locale]) ?? []);

  const byUser = new Map<string, ScrappedForSummary[]>();
  for (const row of rows) {
    // 프로필이 없으면 영어다. 트리거가 가입 시 만들지만(1.3), 없다고 요약을 거르지 않는다
    const locale = localeById.get(row.user_id) ?? 'en';
    // 요약의 링크 글자는 그 사용자가 읽는 언어의 제목이어야 한다.
    // 번역이 없으면 원문으로 — 담아둔 기사가 요약에서 빠지는 것보다 낫다
    const translation = row.articles.article_translations.find((t) => t.locale === locale);

    const list = byUser.get(row.user_id) ?? [];
    list.push({
      articleId: row.articles.id,
      slug: row.articles.slug,
      category: row.articles.category,
      title: translation?.title ?? row.articles.title,
      oneLineSummary: translation?.one_line_summary ?? row.articles.one_line_summary,
      scrappedAt: row.scraped_at,
    });
    byUser.set(row.user_id, list);
  }

  return [...byUser.entries()].map(([userId, articles]) => ({
    userId,
    locale: localeById.get(userId) ?? 'en',
    articles,
  }));
}
