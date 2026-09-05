import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { swapLocale } from '@/config/locales';
import { checkGate, localeRedirect, proxy } from '@/proxy';

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

describe('swapLocale', () => {
  it('첫 세그먼트만 바꾸고 나머지 경로를 유지한다', () => {
    // 슬러그는 두 언어가 공유한다 (D-08). 그래서 hreflang 이 성립한다
    expect(swapLocale('/en/articles/some-slug', 'ko')).toBe('/ko/articles/some-slug');
    expect(swapLocale('/ko', 'en')).toBe('/en');
  });

  it('언어 없는 경로는 그 언어의 목록으로', () => {
    expect(swapLocale('/articles/some-slug', 'ko')).toBe('/ko');
    expect(swapLocale('/', 'ko')).toBe('/ko');
  });
});

describe('proxy 의 언어 리다이렉트', () => {
  /**
   * 개발 환경에서는 게이트가 통과하므로(checkGate) 리다이렉트만 남는다.
   * NODE_ENV 는 vitest 가 'test' 로 두므로 게이트 값을 직접 넣어준다.
   */
  function request(path: string, headers: Record<string, string> = {}) {
    return new NextRequest(new URL(path, 'http://localhost:3000'), { headers });
  }

  beforeEach(() => {
    vi.stubEnv('GATE_USER', 'gate');
    vi.stubEnv('GATE_PASSWORD', 'secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const auth = { authorization: `Basic ${btoa('gate:secret')}` };

  it('언어 없는 경로는 307 이다 — 308 이면 브라우저가 캐시해 언어 변경이 먹지 않는다', async () => {
    const response = await proxy(request('/', auth));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/en');
  });

  it('쿠키를 보고 목적지를 고른다', async () => {
    const response = await proxy(request('/', { ...auth, cookie: 'NEXT_LOCALE=ko' }));

    expect(response.headers.get('location')).toBe('http://localhost:3000/ko');
  });

  it('게이트를 통과하지 못하면 리다이렉트하지 않는다', async () => {
    // 언어 리다이렉트가 게이트보다 앞에 오면 비공개 사이트의 경로 구조가 새어나간다
    const response = await proxy(request('/'));

    expect(response.status).toBe(401);
  });
});
