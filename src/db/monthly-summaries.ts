import type { Locale } from '@/config/locales';
import type { ServiceClient } from '@/db/supabase/service';
import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 월간 요약 저장·조회 (로드맵 6.6, 6.7).
 *
 * 쓰기는 파이프라인(service), 읽기는 앱(anon + RLS)이다.
 * 요약은 본인 것만 보인다 — RLS 정책이 그것을 건다.
 */

export interface SummaryToSave {
  userId: string;
  monthStart: string;
  locale: Locale;
  summaryText: string;
  articleIds: string[];
}

/**
 * 요약을 넣는다. 같은 달·같은 언어를 다시 만들면 덮어쓴다.
 *
 * 발행된 기사와 달리 요약은 고쳐도 된다 (CLAUDE.md §2.2 는 기사 이야기다) —
 * 재실행이 실패한 요약을 고칠 수 있어야 한다.
 */
export async function saveSummary(db: ServiceClient, summary: SummaryToSave): Promise<void> {
  const { error } = await db.from('monthly_summaries').upsert(
    {
      user_id: summary.userId,
      month_start: summary.monthStart,
      locale: summary.locale,
      summary_text: summary.summaryText,
      article_ids: summary.articleIds,
    },
    { onConflict: 'user_id,month_start,locale' },
  );

  if (error) throw new Error(`월간 요약 저장 실패: ${error.message}`);
}

export interface MonthlySummary {
  monthStart: string;
  locale: Locale;
  summaryText: string;
  articleIds: string[];
}

/**
 * 내 요약 목록 (6.7).
 *
 * 최신 달이 먼저다. 언어로 거르지 않는다 — 언어를 바꾸기 전에 받은 요약도
 * 내 것이고, 없는 척하면 사라진 것처럼 보인다.
 */
export async function listMySummaries(
  db: SupabaseClient<Database>,
  limit = 12,
): Promise<MonthlySummary[]> {
  const { data, error } = await db
    .from('monthly_summaries')
    .select('month_start, locale, summary_text, article_ids')
    .order('month_start', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`월간 요약 조회 실패: ${error.message}`);

  return (data ?? []).map((row) => ({
    monthStart: row.month_start,
    locale: row.locale,
    summaryText: row.summary_text,
    articleIds: row.article_ids,
  }));
}
