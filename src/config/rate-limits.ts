import { envInt } from './tunables';

/**
 * Rate limit 상한 (로드맵 7.2).
 *
 * 튜닝 값이므로 config 다 (CLAUDE.md §2.4). 공개 후 실제 트래픽을 보고
 * 재배포 없이 조일 수 있어야 한다.
 *
 * 값의 근거:
 *   - `auth` — 사람이 로그인을 5분에 10번 시도할 일은 없다. 비밀번호 대입을
 *     느리게 만드는 것이 목적이고, 오타 몇 번은 넉넉히 통과한다
 *   - `scrap` — 읽으면서 담는 속도의 상한이다. 목록을 훑으며 연타해도 안 걸리고,
 *     스크립트로 전체를 담는 것은 걸린다
 */
export const rateLimits = {
  /** 로그인·가입. IP 기준 */
  auth: {
    get max() {
      return envInt('TECHNOW_RATE_AUTH_MAX', 10);
    },
    get windowSeconds() {
      return envInt('TECHNOW_RATE_AUTH_WINDOW', 300);
    },
  },

  /** 스크랩 토글. 로그인 사용자 기준 */
  scrap: {
    get max() {
      return envInt('TECHNOW_RATE_SCRAP_MAX', 60);
    },
    get windowSeconds() {
      return envInt('TECHNOW_RATE_SCRAP_WINDOW', 60);
    },
  },
} as const;
