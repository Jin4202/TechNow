import { STYLE_GUIDE_VERSION } from '@/config/required-assets';

import type { Category } from '@/config/categories';
import type { ServiceClient } from '@/db/supabase/service';

/**
 * articles 저장소.
 *
 * 앱은 이 테이블에 쓰지 않는다. 쓰기는 service_role 을 쓰는 파이프라인 전용이다 (D-02).
 */

/**
 * 최근 발행 기사 제목 (로드맵 2.3).
 *
 * 그룹핑 프롬프트에 넣어 follow-up 을 판정한다.
 * 기간은 thresholds.followUpWindowDays.
 */
export async function recentPublishedArticles(
  db: ServiceClient,
  days: number,
): Promise<{ id: string; title: string }[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('articles')
    .select('id, title')
    .eq('status', 'published')
    .gte('published_at', since)
    .order('published_at', { ascending: false });

  if (error) throw new Error(`최근 발행 기사 조회 실패: ${error.message}`);
  return data ?? [];
}

/**
 * 조사·작성·검증을 통과한 기사를 저장한다 (로드맵 3.12, 3.15).
 *
 * 기사와 출처를 함께 넣는다. 출처 없이 기사만 들어가면 섹션의 `sources` 가
 * 존재하지 않는 ordinal 을 가리키게 되어 상세 페이지가 깨진다.
 *
 * 상태는 필수 자산 설정이 정한다 (`required-assets.ts`).
 * Phase 3 에서는 영문 본문만 필수라 바로 `ready` 가 되고,
 * Phase 4~5 에서 번역·이미지가 필수가 되면 `ready_pending` 으로 들어온다.
 */
export interface ArticleToInsert {
  slug: string;
  category: Category;
  tags: string[];
  title: string;
  oneLineSummary: string;
  body: { sections: { heading: string; paragraphs: string[]; sources: number[] }[] };
  runId: string;
  topicHash: string;
  followUpOf: string | null;
  scoreNovelty: number;
  scoreImpact: number;
  scoreInterest: number;
  importanceScore: number;
  status: 'ready' | 'ready_pending';
  sources: {
    ordinal: number;
    url: string;
    title: string | null;
    publisher: string | null;
    tier: 1 | 2;
  }[];
}

export async function insertArticleWithSources(
  db: ServiceClient,
  article: ArticleToInsert,
): Promise<string | null> {
  const { data, error } = await db
    .from('articles')
    .insert({
      slug: article.slug,
      category: article.category,
      tags: article.tags,
      title: article.title,
      one_line_summary: article.oneLineSummary,
      body: article.body,
      run_id: article.runId,
      topic_hash: article.topicHash,
      follow_up_of: article.followUpOf,
      score_novelty: article.scoreNovelty,
      score_impact: article.scoreImpact,
      score_interest: article.scoreInterest,
      importance_score: article.importanceScore,
      status: article.status,
      style_guide_version: STYLE_GUIDE_VERSION,
    })
    .select('id')
    .single();

  if (error) {
    // (run_id, topic_hash) 유니크 인덱스에 걸린 것은 재시도로 인한 중복이다.
    // 실패가 아니라 이미 만들어졌다는 뜻이므로 조용히 넘어간다
    if (error.code === '23505') return null;
    throw new Error(`기사 저장 실패: ${error.message}`);
  }

  const articleId = data.id;

  const { error: sourceError } = await db.from('article_sources').insert(
    article.sources.map((s) => ({
      article_id: articleId,
      ordinal: s.ordinal,
      url: s.url,
      title: s.title,
      publisher: s.publisher,
      tier: s.tier,
    })),
  );

  if (sourceError) {
    // 출처 없는 기사는 섹션 참조가 깨진다. 기사도 같이 되돌린다
    await db.from('articles').delete().eq('id', articleId);
    throw new Error(`출처 저장 실패, 기사도 되돌림: ${sourceError.message}`);
  }

  return articleId;
}
