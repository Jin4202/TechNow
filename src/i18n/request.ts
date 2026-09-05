import { getRequestConfig } from 'next-intl/server';

import { DEFAULT_LOCALE, isLocale } from '@/config/locales';

/**
 * next-intl 요청 설정 (로드맵 4.1).
 *
 * 언어는 URL 세그먼트에서 온다 (D-08). next-intl 의 미들웨어를 쓰지 않으므로
 * `requestLocale` 은 `[locale]` 세그먼트 값이고, 검증은 여기서 한 번 더 한다 —
 * 지원하지 않는 값이 오면 메시지 파일 import 가 던진다.
 *
 * `routing.ts` 를 따로 두지 않는다. 언어 목록의 원본은 `src/config/locales.ts` 하나이고
 * (DB enum 과 대조되는 쪽이다), 여기서 그것을 다시 선언하면 원본이 둘이 된다.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
