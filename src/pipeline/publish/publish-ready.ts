import type { ServiceClient } from '@/db/supabase/service';

/**
 * 준비된 기사를 발행한다 (로드맵 3.13).
 *
 * 규칙 (기획서 §2.5):
 *   - `ready` 인 기사만 발행한다. 필수 자산이 다 갖춰졌다는 뜻이다
 *   - 발행된 기사는 수정하지 않는다 (CLAUDE.md §2.2). 여기서 하는 유일한 변경은
 *     상태 전이와 `published_at` 기록이다
 *   - `ready_pending` 이 이틀 연속 남으면 `failed` 로 넘긴다. 식은 뉴스를 늦게
 *     내보내지 않는다
 */

export interface PublishResult {
  published: number;
  /** 아직 자산이 안 갖춰져 다음 날로 넘어간 기사 */
  heldBack: number;
  /** 2회 연속 hold-back 으로 포기한 기사 */
  failed: number;
  slugs: string[];
}

/** 이 횟수만큼 hold-back 되면 포기한다 */
const MAX_HELD_BACK = 2;

export async function publishReadyArticles(db: ServiceClient): Promise<PublishResult> {
  const now = new Date().toISOString();

  // ── 발행 ────────────────────────────────────────────────
  const { data: published, error: publishError } = await db
    .from('articles')
    .update({ status: 'published', published_at: now })
    .eq('status', 'ready')
    .select('slug');

  if (publishError) throw new Error(`발행 실패: ${publishError.message}`);

  // ── 아직 준비 안 된 기사의 hold-back 카운트 ─────────────
  const { data: pending, error: pendingError } = await db
    .from('articles')
    .select('id, held_back_count')
    .eq('status', 'ready_pending');

  if (pendingError) throw new Error(`대기 기사 조회 실패: ${pendingError.message}`);

  let heldBack = 0;
  let failed = 0;

  for (const article of pending ?? []) {
    const next = article.held_back_count + 1;

    if (next >= MAX_HELD_BACK) {
      const { error } = await db
        .from('articles')
        .update({ status: 'failed', held_back_count: next })
        .eq('id', article.id);
      if (error) throw new Error(`failed 처리 실패: ${error.message}`);
      failed += 1;
    } else {
      const { error } = await db
        .from('articles')
        .update({ held_back_count: next })
        .eq('id', article.id);
      if (error) throw new Error(`hold-back 기록 실패: ${error.message}`);
      heldBack += 1;
    }
  }

  return {
    published: published?.length ?? 0,
    heldBack,
    failed,
    slugs: (published ?? []).map((a) => a.slug),
  };
}
