import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 독자 피드백 저장 (D-28).
 *
 * anon 키로 insert 만 한다. 집계는 읽지 않는다 — 남의 판단이 보이면 지표가 편향된다.
 */

export type FeedbackOutcome = 'recorded' | 'already-voted' | 'not-found';

export async function recordFeedback(
  db: SupabaseClient<Database>,
  input: {
    articleId: string;
    helpful: boolean;
    voterKey: string;
    locale: 'en' | 'ko';
    styleGuideVersion: string | null;
  },
): Promise<FeedbackOutcome> {
  const { error } = await db.from('article_feedback').insert({
    article_id: input.articleId,
    helpful: input.helpful,
    voter_key: input.voterKey,
    locale: input.locale,
    style_guide_version: input.styleGuideVersion,
  });

  if (!error) return 'recorded';

  // 같은 브라우저가 같은 기사에 두 번 — 정상이다. 오류로 다루지 않는다
  if (error.code === '23505') return 'already-voted';

  // RLS 가 막았다는 것은 발행되지 않은 기사라는 뜻이다.
  // 존재하지 않는 것과 구분해서 알려주지 않는다
  if (error.code === '42501') return 'not-found';

  throw new Error(`피드백 기록 실패: ${error.message}`);
}
