'use server';

import { recordFeedback, type FeedbackOutcome } from '@/db/article-feedback';
import { createClient } from '@/db/supabase/server';

import type { Locale } from '@/config/locales';

/**
 * 독자 피드백 서버 액션 (D-28).
 *
 * anon 키로 쓴다. 로그인을 요구하지 않는다 — 기사 읽기에 로그인이 필요 없으므로
 * 투표에만 요구하면 신호가 대부분 사라진다 (기획서 §2.7).
 */
export async function submitFeedback(input: {
  articleId: string;
  helpful: boolean;
  voterKey: string;
  locale: Locale;
  styleGuideVersion: string | null;
}): Promise<{ outcome: FeedbackOutcome }> {
  // voterKey 는 브라우저가 만든다. 형식만 확인하고 내용은 믿지 않는다
  if (!/^[a-z0-9-]{8,64}$/i.test(input.voterKey)) {
    return { outcome: 'not-found' };
  }

  const supabase = await createClient();
  const outcome = await recordFeedback(supabase, input);
  return { outcome };
}
