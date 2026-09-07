import { z } from 'zod';

import { USER_AGENT } from '@/config/http';

/**
 * Brave Search API 클라이언트 (로드맵 3.2).
 *
 * 링크만 받는다. 출처 tier 판정(3.3)과 본문 추출(3.4)은 우리 코드가 한다 —
 * 검색 API 가 추출한 텍스트를 쓰면 tier 규칙과 페이월 스킵이 프롬프트에
 * 의존하게 된다 (MASTER_PLAN §3).
 *
 * 응답을 zod 로 검증한다. API 형식이 바뀌면 조용히 빈 결과가 되는 대신
 * 명시적으로 실패한다.
 */

const WebResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  age: z.string().optional(),
  page_age: z.string().optional(),
});

const SearchResponseSchema = z.object({
  web: z
    .object({
      results: z.array(WebResultSchema).optional(),
    })
    .optional(),
});

export interface SearchResult {
  url: string;
  title: string;
  description: string;
  /**
   * 페이지 발행 시각. `page_age` 를 파싱한 것이며, 없으면 null.
   *
   * **`age` 가 아니라 `page_age` 를 쓴다.** `age` 는 "3 weeks ago" 와
   * "March 5, 2018" 이 섞여 나오고 `page_age` 는 항상 ISO 8601 이다.
   * 실측에서 40건 중 39건(97%)에 값이 있었다 (2026-09-06).
   */
  publishedAt: Date | null;
}

/** `page_age` 는 ISO 8601 이다. 형식이 바뀌면 조용히 null 이 된다 — 배제가 아니라 통과다 */
function parsePageAge(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface BraveClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  /**
   * 호출 간 최소 간격.
   *
   * 실측 헤더는 `x-ratelimit-policy: 50;w=1` — 초당 50회다 (3.2a).
   * 그럼에도 1.1초를 기본값으로 둔다: 우리 사용량은 하루 9회라 속도가
   * 문제되지 않고, 한도를 건드려 차단당하는 쪽이 훨씬 비싸다
   */
  minIntervalMs?: number;
}

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const DEFAULT_MIN_INTERVAL_MS = 1_100;

export class BraveSearchError extends Error {}

export class BraveClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private lastCallAt = 0;
  /** 이 클라이언트가 지금까지 쓴 호출 수. 상한 강제는 호출자가 한다 */
  public callCount = 0;

  constructor(options: BraveClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.BRAVE_API_KEY;
    if (!apiKey) {
      throw new Error('BRAVE_API_KEY 가 필요합니다. Trigger.dev 환경변수를 확인하세요.');
    }
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  /** 레이트 리밋에 여유를 두고 호출한다 */
  private async throttle(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastCallAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCallAt = Date.now();
  }

  async search(query: string, count = 10): Promise<SearchResult[]> {
    await this.throttle();
    this.callCount += 1;

    const url = new URL(ENDPOINT);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    // 뉴스가 아니라 근거 문서를 찾는다. 최근성보다 관련성이 우선이다
    url.searchParams.set('safesearch', 'off');

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BraveSearchError(`Brave 검색 실패: HTTP ${response.status} ${body.slice(0, 200)}`);
    }

    const parsed = SearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new BraveSearchError(`Brave 응답 형식이 예상과 다릅니다: ${parsed.error.message}`);
    }

    return (parsed.data.web?.results ?? []).map((r) => ({
      url: r.url,
      title: r.title ?? '',
      description: r.description ?? '',
      publishedAt: parsePageAge(r.page_age),
    }));
  }
}
