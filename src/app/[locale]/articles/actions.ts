'use server';

import { recordFeedback, type FeedbackOutcome } from '@/db/article-feedback';
import { toggleScrap, type ScrapOutcome } from '@/db/scraps';
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

/**
 * 스크랩 토글 (로드맵 6.1).
 *
 * 로그인이 필요하다 (기획서 §2.7). 로그인하지 않았으면 던지지 않고
 * `not-logged-in` 을 돌려준다 — 버튼이 로그인 안내로 바뀌면 되고,
 * 예외로 만들면 화면이 통째로 에러 경계로 넘어간다.
 *
 * `revalidatePath` 는 하지 않는다. 버튼 상태는 클라이언트가 들고 있고,
 * 스크랩 여부는 페이지의 다른 내용에 영향을 주지 않는다
 */
export async function toggleScrapAction(articleId: string): Promise<{ outcome: ScrapOutcome }> {
  if (!/^[0-9a-f-]{36}$/i.test(articleId)) return { outcome: 'not-found' };

  const supabase = await createClient();
  return { outcome: await toggleScrap(supabase, articleId) };
}
