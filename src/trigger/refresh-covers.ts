import { logger, schemaTask } from '@trigger.dev/sdk';
import { z } from 'zod';

import { getAnthropic } from '@/clients/anthropic';
import { FalClient } from '@/clients/fal';
import { coverUsdPerImage } from '@/config/covers';
import { createServiceClient } from '@/db/supabase/service';
import { illustrateWithRetry } from '@/pipeline/fill-assets';

/**
 * 발행된 기사의 커버를 지금 화풍으로 다시 만든다.
 *
 * ⚠️ **일회용 태스크다. 쓰고 나면 지운다.** (2026-09-06, 사용자 승인)
 *
 * 커버 화풍이 하루에 두 번 바뀌었다 (평면 벡터 → 사진 → 3D 렌더, D-52).
 * 이미 발행된 기사는 옛 화풍이라 목록에서 섞여 보인다. 그것만 맞추는 작업이고,
 * 끝나면 이 파일을 지운다 — **발행된 기사에 손대는 태스크를 저장소에 남겨두면
 * 그 자체가 위험하다** (placeholder 삭제 때와 같은 판단).
 *
 * ## articles 행을 건드리지 않는다
 *
 * `uploadCover` 가 `path = <articleId>.jpg` 에 `upsert: true` 로 쓴다. 옛 커버도
 * 새 커버도 jpeg 이므로 **경로가 같다** — Storage 객체만 바뀌고
 * `cover_image_url` 은 그대로다.
 *
 * 그래서 CLAUDE.md §2.2 가 금지하는 `UPDATE articles ... WHERE status='published'`
 * 가 이 태스크에 **없다.** 발행된 기사의 레코드는 한 글자도 바뀌지 않는다.
 * `saveCoverImageUrl` 의 `.neq('status', 'published')` 가드도 그대로 둔다 —
 * 우회하지 않는다.
 *
 * URL 이 그대로라서 **캐시가 한동안 옛 그림을 준다** (Supabase 기본 max-age 1시간).
 *
 * ## 기본이 dry-run 이다
 *
 * 돈이 나가고(장당 $0.06) 되돌릴 수 없다. 먼저 무엇을 몇 건 바꿀지 보고 실행한다.
 */
export const refreshCoversTask = schemaTask({
  id: 'refresh-covers',
  maxDuration: 1800,
  schema: z.object({
    /** false 로 줘야 실제로 바꾼다. 기본은 세어보기만 한다 */
    apply: z.boolean().default(false),
    /** 비워두면 커버가 있는 발행 기사 전부 */
    slugs: z.array(z.string()).optional(),
  }),
  run: async ({ apply, slugs }) => {
    const db = createServiceClient();

    let query = db
      .from('articles')
      .select('id, slug, title, one_line_summary, body, cover_image_url')
      .eq('status', 'published')
      .not('cover_image_url', 'is', null);

    if (slugs?.length) query = query.in('slug', slugs);

    const { data, error } = await query;
    if (error) throw new Error(`발행 기사 조회 실패: ${error.message}`);

    const targets = data ?? [];
    const estimatedUsd = Number((targets.length * coverUsdPerImage).toFixed(3));

    if (!apply) {
      return {
        dryRun: true,
        wouldRefresh: targets.length,
        estimatedUsd,
        slugs: targets.map((a) => a.slug),
        note: 'apply: true 로 다시 부르면 실제로 바꾼다',
      };
    }

    const claude = getAnthropic();
    const fal = new FalClient();
    const done: string[] = [];
    const failed: { slug: string; failure: string; detail?: string }[] = [];
    let images = 0;

    for (const article of targets) {
      // 커버 컨셉은 heading·paragraphs 만 읽지만(ArticleBrief) ArticleAssets 는
      // sources 까지 요구한다. body 를 그대로 넘긴다
      const body = article.body as {
        sections: { heading: string; paragraphs: string[]; sources: number[] }[];
      };

      const result = await illustrateWithRetry(db, claude, fal, {
        id: article.id,
        title: article.title,
        oneLineSummary: article.one_line_summary,
        sections: body.sections,
        locales: [],
        coverImageUrl: article.cover_image_url,
      });
      images += result.images;

      if (result.publicUrl) {
        done.push(article.slug);
        logger.info('커버 교체', { slug: article.slug });
      } else {
        failed.push({ slug: article.slug, failure: result.failure!, detail: result.detail });
        logger.warn('커버 교체 실패', { slug: article.slug, failure: result.failure });
      }
    }

    return {
      dryRun: false,
      refreshed: done.length,
      failed,
      images,
      imageUsd: Number((images * coverUsdPerImage).toFixed(3)),
      slugs: done,
    };
  },
});
