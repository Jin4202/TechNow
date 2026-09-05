import {
  ACCEPTED_CONTENT_TYPES,
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  PER_DOMAIN_DELAY_MS,
  USER_AGENT,
} from '@/config/http';

import { extractArticle } from './extract-article';
import { isAllowed, parseRobots, type RobotsRules } from './robots';

/**
 * 외부 페이지를 가져와 본문을 뽑는다 (로드맵 3.4, 2.5 에서 먼저 쓴다).
 *
 * 규약 (CLAUDE.md §2.8):
 *   - robots.txt 를 확인한다. 못 읽으면 보수적으로 허용한다 (robots.txt 부재는 허용이 표준)
 *   - 식별 가능한 User-Agent 를 보낸다
 *   - 같은 도메인을 연달아 때리지 않는다
 */

/** 실패 사유. 로그와 캘리브레이션에서 집계한다 */
export type FetchFailure =
  | 'robots-disallowed'
  | 'http-error'
  | 'wrong-content-type'
  | 'too-large'
  | 'network-error'
  /** 아래는 추출 단계에서 온다 */
  | 'no-content'
  | 'too-short'
  | 'paywalled';

export interface FetchPageSuccess {
  ok: true;
  url: string;
  title: string | null;
  text: string;
  siteName: string | null;
  /** 협찬 기사로 보이는가. 출처로 쓸지는 호출자가 정한다 */
  sponsored: boolean;
}

export interface FetchPageError {
  ok: false;
  url: string;
  reason: FetchFailure;
  detail?: string;
}

export type FetchPageResult = FetchPageSuccess | FetchPageError;

export interface FetchContext {
  /** 호스트별 robots 규칙 캐시. 한 런 안에서 재사용한다 */
  robotsCache: Map<string, RobotsRules | null>;
  /** 호스트별 마지막 요청 시각 */
  lastRequestAt: Map<string, number>;
  fetchImpl: typeof fetch;
}

export function createFetchContext(fetchImpl: typeof fetch = fetch): FetchContext {
  return { robotsCache: new Map(), lastRequestAt: new Map(), fetchImpl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 같은 도메인 연속 요청 사이에 간격을 둔다 */
async function throttle(context: FetchContext, host: string): Promise<void> {
  const last = context.lastRequestAt.get(host);
  const now = Date.now();
  if (last !== undefined) {
    const wait = PER_DOMAIN_DELAY_MS - (now - last);
    if (wait > 0) await sleep(wait);
  }
  context.lastRequestAt.set(host, Date.now());
}

async function loadRobots(context: FetchContext, origin: string): Promise<RobotsRules | null> {
  const cached = context.robotsCache.get(origin);
  if (cached !== undefined) return cached;

  let rules: RobotsRules | null = null;
  try {
    const response = await context.fetchImpl(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // 404 는 "제한 없음" 이라는 뜻이다
    if (response.ok) rules = parseRobots(await response.text());
  } catch {
    // 못 읽으면 규칙 없음으로 본다. robots.txt 부재는 허용이 표준이다
  }

  context.robotsCache.set(origin, rules);
  return rules;
}

export async function fetchPage(context: FetchContext, rawUrl: string): Promise<FetchPageResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, url: rawUrl, reason: 'network-error', detail: 'URL 파싱 실패' };
  }

  const rules = await loadRobots(context, url.origin);
  if (rules && !isAllowed(rules, url.pathname)) {
    return { ok: false, url: rawUrl, reason: 'robots-disallowed' };
  }

  await throttle(context, url.host);

  let response: Response;
  try {
    response = await context.fetchImpl(rawUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
  } catch (error) {
    return {
      ok: false,
      url: rawUrl,
      reason: 'network-error',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    return { ok: false, url: rawUrl, reason: 'http-error', detail: `HTTP ${response.status}` };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!ACCEPTED_CONTENT_TYPES.some((t) => contentType.includes(t))) {
    return { ok: false, url: rawUrl, reason: 'wrong-content-type', detail: contentType };
  }

  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) {
    return { ok: false, url: rawUrl, reason: 'too-large', detail: `${declaredLength}B` };
  }

  const html = await response.text();
  if (html.length > MAX_RESPONSE_BYTES) {
    return { ok: false, url: rawUrl, reason: 'too-large', detail: `${html.length}B` };
  }

  const extracted = extractArticle(html, rawUrl);
  if (!extracted.ok) {
    return { ok: false, url: rawUrl, reason: extracted.reason, detail: `${extracted.chars}자` };
  }

  return {
    ok: true,
    url: response.url || rawUrl,
    title: extracted.title,
    text: extracted.text,
    siteName: extracted.siteName,
    sponsored: extracted.sponsored,
  };
}
