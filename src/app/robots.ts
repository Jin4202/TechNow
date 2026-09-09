import { SITE_URL } from '@/config/site';

import type { MetadataRoute } from 'next';

/**
 * robots.txt (로드맵 7.1a).
 *
 * 색인을 **연다.** 지금 주소는 `vercel.app` 이고 2차 공개에서 커스텀 도메인으로
 * 옮기면서 301 로 넘긴다 — 새 사이트라 옮길 때 잃을 순위가 없고, 지금 막아두면
 * 색인이 어떻게 도는지 볼 기회 자체가 없다 (2026-09-09 사용자 결정).
 *
 * 막는 것은 **계정 전용 경로**뿐이다. 지금은 404 지만(7.0c) 2차에서 열리고,
 * 그때도 로그인한 본인에게만 의미가 있어 색인 대상이 아니다. 크롤러가 안 되는
 * 문을 두드리게 두지 않는다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/*/login', '/*/profile', '/*/scraps', '/*/summary', '/auth/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
