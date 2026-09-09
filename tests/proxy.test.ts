import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { swapLocale } from '@/config/locales';
import { localeRedirect, proxy } from '@/proxy';

/**
 * **접근 게이트 테스트가 여기 있었고 7.7 에서 함께 사라졌다** (2026-09-09).
 * `checkGate` 8개와 "게이트를 통과하지 못하면 리다이렉트하지 않는다" 가 그것이다.
 * 사이트가 공개됐으므로 그 판정이 존재하지 않는다.
 *
 * 남은 것은 언어 리다이렉트와 세션 갱신이고, 둘 다 계속 남는다.
 */

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
  function request(path: string, headers: Record<string, string> = {}) {
    return new NextRequest(new URL(path, 'http://localhost:3000'), { headers });
  }

  it('언어 없는 경로는 307 이다 — 308 이면 브라우저가 캐시해 언어 변경이 먹지 않는다', async () => {
    const response = await proxy(request('/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3000/en');
  });

  it('쿠키를 보고 목적지를 고른다', async () => {
    const response = await proxy(request('/', { cookie: 'NEXT_LOCALE=ko' }));

    expect(response.headers.get('location')).toBe('http://localhost:3000/ko');
  });

  it('자격증명 없이도 리다이렉트된다 — 게이트가 없다 (7.7)', async () => {
    // 게이트 시절에는 같은 요청이 401 이었다. 이 테스트가 그 차이를 고정한다
    const response = await proxy(request('/articles/some-slug'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/en/articles/some-slug',
    );
  });
});
