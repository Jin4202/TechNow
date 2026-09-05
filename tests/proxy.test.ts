import { describe, expect, it } from 'vitest';

import { checkGate, localeRedirect } from '@/proxy';

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

describe('localeRedirect', () => {
  it('언어가 이미 붙어 있으면 그대로 둔다', () => {
    expect(localeRedirect('/en', {})).toBeNull();
    expect(localeRedirect('/ko/articles/some-slug', {})).toBeNull();
  });

  it('루트는 기본 언어로 (슬래시가 겹치지 않는다)', () => {
    expect(localeRedirect('/', {})).toBe('/en');
  });

  it('언어 없는 경로에 접두사를 붙이고 나머지를 유지한다', () => {
    expect(localeRedirect('/articles/some-slug', {})).toBe('/en/articles/some-slug');
  });

  it('쿠키가 Accept-Language 를 이긴다 — 사용자가 직접 고른 값이다', () => {
    expect(localeRedirect('/', { cookie: 'ko', acceptLanguage: 'en-US,en;q=0.9' })).toBe('/ko');
  });

  it('쿠키가 없으면 Accept-Language 를 본다', () => {
    expect(localeRedirect('/', { acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8' })).toBe('/ko');
  });

  it('지원하지 않는 언어는 건너뛰고 다음 후보를 본다', () => {
    expect(localeRedirect('/', { acceptLanguage: 'fr-FR,fr;q=0.9,ko;q=0.8' })).toBe('/ko');
  });

  it('쿠키 값이 지원 목록 밖이면 무시한다', () => {
    expect(localeRedirect('/', { cookie: 'ja', acceptLanguage: 'ko' })).toBe('/ko');
  });

  it('아무 단서도 없으면 영어다 — 영어가 원본 언어다 (기획서 §0)', () => {
    expect(localeRedirect('/', { acceptLanguage: 'fr-FR,de;q=0.9' })).toBe('/en');
  });

  it('파일처럼 생긴 경로는 건드리지 않는다', () => {
    // /en/robots.txt 로 돌리면 404 가 된다. 언어판이 없는 리소스다
    expect(localeRedirect('/robots.txt', {})).toBeNull();
    expect(localeRedirect('/sitemap.xml', { cookie: 'ko' })).toBeNull();
  });
});
