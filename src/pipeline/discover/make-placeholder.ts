import { feeds } from '@/config/feeds';

import type { Category } from '@/config/categories';
import type { FeedItem } from './parse-feed';

/**
 * 임시 placeholder 기사 (로드맵 1.9).
 *
 * Phase 1이 파이프라인 배선과 목록 페이지를 확인하기 위한 임시 경로다.
 * 3.15 에서 실제 조사·작성 파이프라인으로 교체하면서 통째로 지운다.
 *
 * 진짜 기사가 아니므로 출처도 점수도 없다. 그래서 이 파일은 src/pipeline 안에
 * 있지만 다른 단계가 이걸 import 하면 안 된다.
 */

export interface PlaceholderArticle {
  slug: string;
  category: Category;
  title: string;
  one_line_summary: string;
  body: { sections: { heading: string; paragraphs: string[]; sources: number[] }[] };
  topic_hash: string;
  status: 'published';
  published_at: string;
}

/** 피드가 주로 다루는 첫 카테고리를 쓴다. 진짜 분류는 Phase 3에서 한다 */
function categoryForFeed(feedName: string): Category {
  return feeds.find((f) => f.name === feedName)?.covers[0] ?? 'ai-computing';
}

/**
 * 제목에서 URL 슬러그를 만든다.
 *
 * 한글·기호를 걷어내고 나면 빈 문자열이 될 수 있으므로 해시 접미사를 항상 붙인다.
 * articles.slug 는 unique 라 충돌하면 삽입이 통째로 실패한다.
 */
export function makeSlug(title: string, urlHash: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');

  const suffix = urlHash.slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}

export function makePlaceholder(item: FeedItem, now: Date = new Date()): PlaceholderArticle {
  const summary = item.description.slice(0, 200) || item.title;

  return {
    slug: makeSlug(item.title, item.urlHash),
    category: categoryForFeed(item.feedName),
    title: item.title,
    one_line_summary: summary,
    body: {
      sections: [
        {
          heading: 'Placeholder',
          paragraphs: [
            'Phase 1의 임시 항목입니다. 실제 기사는 Phase 3의 조사·작성 파이프라인이 만듭니다.',
            `원본 피드: ${item.feedName} — ${item.url}`,
          ],
          // 출처가 없으므로 빈 배열. 진짜 기사는 3.6a 검증을 통과해야 한다
          sources: [],
        },
      ],
    },
    topic_hash: item.urlHash,
    status: 'published',
    published_at: now.toISOString(),
  };
}
