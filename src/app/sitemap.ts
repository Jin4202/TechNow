import { LOCALES } from '@/config/locales';
import { SITE_URL } from '@/config/site';
import { listArchiveMonths, listSitemapEntries } from '@/db/published-articles';
import { createClient } from '@/db/supabase/server';

import type { Locale } from '@/config/locales';
import type { MetadataRoute } from 'next';

/**
 * 사이트맵 (로드맵 7.1a).
 *
 * 매일 기사가 늘어나는 사이트라 색인이 사이트맵에 실제로 의존한다. 홈은 최신
 * 30건에서 잘리므로 그보다 오래된 기사로 가는 내부 링크는 아카이브뿐이다.
 *
 * `[locale]` 세그먼트 **밖**에 있다. 사이트맵은 한 벌이고 그 안에서 언어별
 * URL 을 나열한다 — 언어마다 사이트맵이 따로 생기면 hreflang 을 표현할 수 없다.
 *
 * **잠긴 경로(`/login`·`/profile`·`/scraps`·`/summary`)는 넣지 않는다.** 지금은
 * 404 이고 (7.0c), 열린 뒤에도 로그인 전용이라 색인 대상이 아니다.
 */

/** 언어별 URL 과 hreflang 을 한 항목으로 만든다 */
function entry(
  path: string,
  locales: readonly Locale[],
  lastModified?: string,
): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(locales.map((l) => [l, `${SITE_URL}/${l}${path}`]));

  return locales.map((locale) => ({
    url: `${SITE_URL}/${locale}${path}`,
    ...(lastModified ? { lastModified: new Date(lastModified) } : {}),
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();
  const [articles, months] = await Promise.all([
    listSitemapEntries(supabase),
    listArchiveMonths(supabase),
  ]);

  return [
    ...entry('', LOCALES),
    ...entry('/about', LOCALES),
    ...entry('/archive', LOCALES),
    ...months.flatMap((m) => entry(`/archive/${m.month}`, LOCALES)),
    // 번역이 있는 언어만 넣는다. 없는 언어판은 404 라 사이트맵에 넣으면 거짓말이다
    ...articles.flatMap((a) => entry(`/articles/${a.slug}`, a.locales, a.publishedAt)),
  ];
}
