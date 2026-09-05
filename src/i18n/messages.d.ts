import type { Locale } from '@/config/locales';
import type messages from '@/messages/en.json';

/**
 * 메시지 키를 타입으로 고정한다 (4.1).
 *
 * 영어를 기준 파일로 삼는다 — 영어가 원본 언어다 (기획서 §0).
 * 없는 키를 `t()` 에 쓰면 여기서 걸린다. 두 파일의 키가 어긋나는 것은
 * tests/messages.test.ts 가 잡는다 (타입은 en 만 본다).
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
