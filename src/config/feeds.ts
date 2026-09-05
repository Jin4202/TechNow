import type { Category } from './categories';

/**
 * RSS 피드 목록 (로드맵 1.5, 기준은 D-16).
 *
 * 피드 항목은 주제 발굴 신호일 뿐이다. 기사 본문의 재료가 아니다.
 *
 * 주의: 일부 피드는 기본 User-Agent 를 거부한다 (Phys.org 는 400을 돌려준다).
 * 수집기는 반드시 식별 가능한 User-Agent 를 보낸다 (CLAUDE.md §2.8).
 */
export interface Feed {
  /** 로그와 seen_feed_items.feed_name 에 쓰는 식별자 */
  name: string;
  url: string;
  /** 이 피드가 주로 커버하는 카테고리 (커버리지 확인용, 분류에 쓰지 않음) */
  covers: readonly Category[];
  /** 대략적인 1회 수집량. 총량 감을 잡는 용도 */
  approxItems: number;
}

export const feeds: readonly Feed[] = [
  {
    name: 'phys-org',
    url: 'https://phys.org/rss-feed/',
    covers: [
      'space-astronomy',
      'physics-materials',
      'climate-energy',
      'health-biotech',
      'ai-computing',
    ],
    approxItems: 30,
  },
  {
    name: 'science-daily',
    url: 'https://www.sciencedaily.com/rss/all.xml',
    covers: ['health-biotech', 'climate-energy', 'physics-materials', 'space-astronomy'],
    approxItems: 60,
  },
  {
    name: 'ars-technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    covers: ['ai-computing', 'industry-policy', 'robotics-hardware', 'space-astronomy'],
    approxItems: 20,
  },
  {
    name: 'ieee-spectrum',
    url: 'https://spectrum.ieee.org/feeds/feed.rss',
    covers: ['robotics-hardware', 'ai-computing', 'climate-energy', 'industry-policy'],
    approxItems: 30,
  },
  {
    // 1차 출처. 기관 발표는 Tier 1 확보(3.10)에 직접 도움이 된다
    name: 'nasa',
    url: 'https://www.nasa.gov/news-release/feed/',
    covers: ['space-astronomy'],
    approxItems: 10,
  },
] as const;

/**
 * 수집기가 보내는 User-Agent.
 * 페이지 수집과 같은 값을 쓴다 — 차단당하면 한 곳만 고치면 된다
 */
export { USER_AGENT as FEED_USER_AGENT } from './http';
