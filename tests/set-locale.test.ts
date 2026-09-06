import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 언어 변경 서버 액션 (로드맵 4.2, D-08).
 *
 * 확인하려는 것: **로그인한 사용자의 선택이 `profiles.locale` 에 저장된다.**
 * 쿠키만 갱신되면 그 기기에서만 유지되고, 다른 기기에서 로그인하면 영어로 돌아간다.
 *
 * 실제 로그인 흐름(브라우저 → Supabase Auth)은 여기서 다루지 않는다.
 * 여기서 고정하는 것은 "세션이 있으면 프로필도 쓴다" 는 분기다.
 */

const cookieStore = { set: vi.fn() };
const updateLocale = vi.fn();
const redirect = vi.fn();

let currentUser: { id: string } | null = null;

vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));
vi.mock('@/db/profiles', () => ({
  updateLocale: (...args: unknown[]) => updateLocale(...args),
  getProfile: async () => null,
}));
vi.mock('@/db/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: currentUser } }) },
  }),
}));

const { setLocale } = await import('@/app/[locale]/profile/actions');

describe('setLocale', () => {
  beforeEach(() => {
    cookieStore.set.mockClear();
    updateLocale.mockClear();
    redirect.mockClear();
    currentUser = null;
  });

  it('로그인했으면 프로필에 저장한다 — 기기를 넘어 따라와야 한다', async () => {
    currentUser = { id: 'user-1' };

    await setLocale('ko', '/en/articles/some-slug');

    expect(updateLocale).toHaveBeenCalledWith(expect.anything(), 'user-1', 'ko');
  });

  it('로그인하지 않아도 쿠키는 남는다 — 기사 읽기에 로그인이 필요 없다 (기획서 §2.7)', async () => {
    await setLocale('ko', '/en');

    expect(updateLocale).not.toHaveBeenCalled();
    expect(cookieStore.set).toHaveBeenCalledWith(
      'NEXT_LOCALE',
      'ko',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('같은 페이지의 다른 언어판으로 보낸다', async () => {
    await setLocale('ko', '/en/articles/some-slug');

    expect(redirect).toHaveBeenCalledWith('/ko/articles/some-slug');
  });

  it('지원하지 않는 언어는 거부한다', async () => {
    // 서버 액션은 아무나 부를 수 있다. 클라이언트가 보낸 값을 믿지 않는다
    await expect(setLocale('ja' as 'ko', '/en')).rejects.toThrow();
    expect(cookieStore.set).not.toHaveBeenCalled();
  });
});
