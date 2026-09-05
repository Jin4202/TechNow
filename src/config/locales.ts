/**
 * 지원 언어.
 *
 * URL 경로의 첫 세그먼트가 언어다 (D-08). `/en/articles/...`, `/ko/articles/...`.
 *
 * **이 목록이 원본이다.** DB 의 `locale` enum, next-intl 설정(4.1),
 * `article_translations.locale` 이 전부 여기와 맞아야 한다 —
 * tests/config.test.ts 가 DB 타입과 대조해 어긋나면 깨진다.
 */

export const LOCALES = ['en', 'ko'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * 언어 없는 경로로 들어왔을 때의 최후 기본값.
 *
 * 영어가 원본 언어다 (기획서 §0). 번역이 없는 기사도 영어로는 항상 있다.
 */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * 언어 선택을 담는 쿠키.
 *
 * `profiles.locale` 이 원본이고 이 쿠키는 그 사본이다 (D-08).
 * proxy 는 요청마다 DB 를 조회하지 않고 이 쿠키만 읽는다 — 로그인하지 않은
 * 독자도 선택을 유지할 수 있어야 하고, 리다이렉트 하나에 DB 왕복을 붙일 이유가 없다.
 */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * 경로 세그먼트를 언어로 바꾼다.
 *
 * 레이아웃이 이미 지원하지 않는 언어를 404 로 막지만, 레이아웃과 페이지는
 * 함께 렌더되기 시작하므로 페이지 쪽도 스스로 안전해야 한다.
 * 여기서 던지지 않고 기본값으로 내려가는 이유다 — 사용자가 보는 결과는
 * 레이아웃의 404 이고, 이 값은 그때까지 렌더에만 쓰인다.
 */
export function toLocale(value: string): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
