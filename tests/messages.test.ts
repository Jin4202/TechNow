import { describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import ko from '@/messages/ko.json';

/**
 * 두 메시지 파일의 키가 같아야 한다 (4.1).
 *
 * 타입은 영어 파일만 본다 (`src/i18n/messages.d.ts`). 한국어에 키를 빠뜨리면
 * 타입은 통과하고 화면에만 키 이름이 그대로 뜬다 — 그것을 여기서 잡는다.
 */

function flatKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('메시지 파일', () => {
  it('en 과 ko 의 키가 같다', () => {
    expect(flatKeys(ko).sort()).toEqual(flatKeys(en).sort());
  });

  it('빈 문자열이 없다', () => {
    for (const [name, messages] of [
      ['en', en],
      ['ko', ko],
    ] as const) {
      const empty = flatKeys(messages).filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages);
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(empty, `${name} 에 빈 문구가 있다`).toEqual([]);
    }
  });
});
