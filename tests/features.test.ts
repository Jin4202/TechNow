import { afterEach, describe, expect, it, vi } from 'vitest';

import { features } from '@/config/features';

/**
 * 기능 스위치 (로드맵 7.0c).
 *
 * **2차 공개에서 이 플래그를 켤 때의 안전망이다.** 켜는 방법이 정확히 `'1'` 이라는
 * 것을 고정한다 — `TECHNOW_ACCOUNTS=true` 로 써놓고 켜졌다고 믿는 것이 이 값의
 * 유일한 실패 모드다. 값이 틀리면 조용히 꺼진 채로 남는다.
 */
describe('features.accounts', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("'1' 이면 켜진다", () => {
    vi.stubEnv('TECHNOW_ACCOUNTS', '1');
    expect(features.accounts).toBe(true);
  });

  it('환경변수가 없으면 꺼져 있다 — 배포에서 빠뜨려도 가입이 열리지 않는다', () => {
    vi.stubEnv('TECHNOW_ACCOUNTS', undefined);
    expect(features.accounts).toBe(false);
  });

  it.each(['true', 'yes', 'on', '0', ''])('%o 은 켜지 않는다', (value) => {
    vi.stubEnv('TECHNOW_ACCOUNTS', value);
    expect(features.accounts).toBe(false);
  });

  it('모듈 로드 시점이 아니라 접근 시점에 읽는다', () => {
    vi.stubEnv('TECHNOW_ACCOUNTS', '1');
    expect(features.accounts).toBe(true);
    vi.stubEnv('TECHNOW_ACCOUNTS', '0');
    expect(features.accounts).toBe(false);
  });
});
