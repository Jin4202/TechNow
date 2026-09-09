import { SITE_URL } from './site';

/**
 * 외부 페이지를 가져올 때의 규약 (CLAUDE.md §2.8).
 *
 * 우리는 남의 서버에서 콘텐츠를 읽는다. 식별 가능한 UA 를 보내고,
 * robots.txt 를 지키고, 같은 도메인을 연달아 때리지 않는다.
 */

/**
 * 어디서 온 요청인지 알 수 있어야 한다. 차단당해도 이유를 알려줄 수 있다.
 *
 * 주소를 여기 다시 적지 않고 `SITE_URL` 을 읽는다 — 2차 공개에서 도메인이
 * 바뀔 때 고칠 곳이 한 군데여야 한다 (7.1a).
 */
export const USER_AGENT = `TechNowBot/0.1 (+${SITE_URL})`;

/** 페이지 하나를 기다리는 최대 시간 */
export const FETCH_TIMEOUT_MS = 20_000;

/** 같은 도메인에 연속 요청할 때의 최소 간격 */
export const PER_DOMAIN_DELAY_MS = 1_500;

/** 이보다 큰 응답은 본문이 아니라고 본다 (바이트) */
export const MAX_RESPONSE_BYTES = 5_000_000;

/** 본문으로 다룰 content-type */
export const ACCEPTED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml'] as const;
