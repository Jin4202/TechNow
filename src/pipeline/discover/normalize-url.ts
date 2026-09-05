import { createHash } from 'node:crypto';

/**
 * 같은 기사를 가리키는 URL 들이 같은 해시를 갖도록 정규화한다.
 *
 * seen_feed_items 는 URL 해시로만 중복을 판단한다 (기획서 §2.1).
 * 추적 파라미터가 붙어 온다는 이유로 같은 기사를 이틀 연속 처리하면
 * 고정비가 그만큼 새어나간다.
 */

/** 콘텐츠를 바꾸지 않는 추적 파라미터 */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'igshid', 'mc_cid', 'mc_eid', 'ref', 'source',
];

export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // URL 로 파싱되지 않으면 원문을 그대로 쓴다. 해시가 달라져도
    // 중복이 한 번 더 처리될 뿐, 잘못된 병합보다는 낫다
    return trimmed;
  }

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';

  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  // 파라미터 순서가 달라도 같은 URL 이다
  url.searchParams.sort();

  // 루트가 아닌 경로의 끝 슬래시는 제거
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** seen_feed_items.url_hash 값 */
export function urlHash(raw: string): string {
  return createHash('sha256').update(normalizeUrl(raw)).digest('hex');
}
