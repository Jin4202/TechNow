import { describe, expect, it } from 'vitest';

import { checkGate } from '@/proxy';

const CREDENTIALS = { user: 'gate', password: 'secret', isDevelopment: false };

function basic(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

describe('checkGate', () => {
  it('자격증명이 맞으면 통과', () => {
    expect(checkGate(basic('gate', 'secret'), CREDENTIALS)).toBe('allow');
  });

  it('Authorization 헤더가 없으면 401', () => {
    expect(checkGate(null, CREDENTIALS)).toBe('challenge');
  });

  it('비밀번호가 틀리면 401', () => {
    expect(checkGate(basic('gate', 'wrong'), CREDENTIALS)).toBe('challenge');
  });

  it('사용자명이 틀리면 401', () => {
    expect(checkGate(basic('someone', 'secret'), CREDENTIALS)).toBe('challenge');
  });

  it('Basic 이 아닌 스킴은 401', () => {
    expect(checkGate('Bearer abc123', CREDENTIALS)).toBe('challenge');
  });

  it('base64가 깨져 있으면 401', () => {
    expect(checkGate('Basic !!!not-base64!!!', CREDENTIALS)).toBe('challenge');
  });

  it('콜론이 없으면 401', () => {
    expect(checkGate(`Basic ${btoa('nocolon')}`, CREDENTIALS)).toBe('challenge');
  });

  it('비밀번호에 콜론이 들어 있어도 첫 콜론만 구분자로 쓴다', () => {
    const env = { user: 'gate', password: 'a:b:c', isDevelopment: false };
    expect(checkGate(basic('gate', 'a:b:c'), env)).toBe('allow');
  });

  describe('설정이 비어 있을 때', () => {
    it('프로덕션에서는 통과가 아니라 차단 (fail closed)', () => {
      const env = { user: undefined, password: undefined, isDevelopment: false };
      expect(checkGate(basic('gate', 'secret'), env)).toBe('misconfigured');
    });

    it('비밀번호만 빠져도 차단', () => {
      const env = { user: 'gate', password: undefined, isDevelopment: false };
      expect(checkGate(basic('gate', 'secret'), env)).toBe('misconfigured');
    });

    it('개발 환경에서는 통과시켜 로컬 작업을 막지 않는다', () => {
      const env = { user: undefined, password: undefined, isDevelopment: true };
      expect(checkGate(null, env)).toBe('allow');
    });
  });

  it('개발 환경에서는 자격증명이 설정돼 있어도 요구하지 않는다', () => {
    const env = { user: 'gate', password: 'secret', isDevelopment: true };
    expect(checkGate(null, env)).toBe('allow');
  });
});
