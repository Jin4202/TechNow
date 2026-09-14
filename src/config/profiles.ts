/**
 * 발행 프로필 (로드맵 7.9b, D-61).
 *
 * **하루에 몇 편을, 어떤 규칙으로 고를지를 한 묶음으로 둔다.** 파이프라인 코드는
 * 하나이고, 프로필만 바꿔 끼운다. 환경변수 `TECHNOW_PROFILE` 하나로 전환하며
 * Trigger.dev 환경변수는 재배포 없이 다음 런부터 반영된다 (CLAUDE.md §2.4).
 *
 * **숫자를 개별 환경변수로 따로 덮지 않는다.** 상한·재채점 수·논문 규칙·분야 규칙·예산은
 * 서로를 전제한다 — 2편 프로필에 상한만 5 로 덮으면 "논문 최대 1" 이 5편 중 1편이
 * 되어 규칙의 뜻이 바뀐다. 그래서 묶음 단위로만 고른다.
 *
 * 비용 (2026-09-08 ~ 09-14 실측: 기사당 변동비 $0.307, 고정비 $0.102/일):
 *
 *   two  2편  월 약 $21.5  예산 $30  알림선 $24
 *   one  1편  월 약 $12.3  예산 $18  알림선 $14.4
 *
 * 예산이 프로필에 묶인 이유: 알림(예산의 80%)이 **평소 지출 바로 위**에 서야 이상을
 * 잡는다. 5편 시절 예산 $40 을 그대로 두면 알림선 $32 에 2편 지출 $21.5 라 영영
 * 안 울린다.
 */

export const PROFILE_NAMES = ['two', 'one'] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

/**
 * 논문 토픽을 어떻게 다루나 (D-57, D-61).
 *
 * 왜 필요한가: 후보 풀의 66% 가 논문 보도자료 재게시처(ScienceDaily, phys.org)이고
 * novelty 앵커가 "A paper ... made public today" 를 5점으로 정의해서 임계 통과에서
 * 논문으로 더 쏠린다. 사용자가 "사실상 논문을 그대로 요약해놓은 기사" 를 지목했다.
 * 점수 조정은 두 번 시도해 두 번 다 실패했고(D-56, D-57), 카운터로 막는다.
 */
export type PaperPolicy =
  /** 하루에 논문을 최대 `max` 편 */
  | { mode: 'quota'; max: number }
  /**
   * 비논문이 하나도 **안 되는** 날에만 논문 (1편 프로필).
   * "없는 날" 이 아니다 — 비논문이 전부 조사에 실패해도 그때 논문으로 내려간다
   */
  | { mode: 'last-resort' };

export interface PublishingProfile {
  name: ProfileName;
  /** 하루 발행 상한. 도달 목표가 아니라 천장이다 (D-46) */
  dailyCap: number;
  /** 원문을 가져와 다시 채점할 상위 토픽 수. 상한의 3배 (D-19) */
  rescoreTopN: number;
  papers: PaperPolicy;
  /**
   * 같은 분야 두 편을 금지하는가.
   * 판정은 채점의 예측이 아니라 **이미 만들어진 기사의 실제 분야**를 본다
   */
  distinctCategories: boolean;
  /** 월 총예산 (USD). 알림은 이 값의 `budget.alertRatio` 에서 울린다 */
  monthlyUsd: number;
}

export const PROFILES: Record<ProfileName, PublishingProfile> = {
  /**
   * 하루 2편. 논문은 최대 1편이고 두 편의 분야가 겹치지 않는다.
   * 둘 중 하나가 논문이어도 다른 하나는 사건·제품·트렌드가 된다
   */
  two: {
    name: 'two',
    dailyCap: 2,
    rescoreTopN: 6,
    papers: { mode: 'quota', max: 1 },
    distinctCategories: true,
    monthlyUsd: 30,
  },
  /**
   * 하루 1편. 비논문 우선 — 한 편뿐인 날 그게 논문 요약이면 그날 사이트의 인상이
   * 그걸로 정해진다. 한 편이므로 분야 겹침은 일어날 수 없다
   */
  one: {
    name: 'one',
    dailyCap: 1,
    rescoreTopN: 3,
    papers: { mode: 'last-resort' },
    distinctCategories: false,
    monthlyUsd: 18,
  },
};

export const DEFAULT_PROFILE: ProfileName = 'two';

export function isProfileName(value: string): value is ProfileName {
  return (PROFILE_NAMES as readonly string[]).includes(value);
}

/**
 * 지금 쓸 프로필.
 *
 * **접근 시점에 읽는다** — 모듈 로드 시 한 번 읽으면 같은 워커가 살아 있는 동안
 * 전환이 반영되지 않는다 (`thresholds` 와 같은 이유).
 *
 * 모르는 값은 경고하고 기본값을 쓴다. 오타로 파이프라인이 멈추면 안 된다
 * (`envNumber` 와 같은 규약).
 */
export function activeProfile(): PublishingProfile {
  const raw = process.env.TECHNOW_PROFILE?.trim();
  if (!raw) return PROFILES[DEFAULT_PROFILE];
  if (isProfileName(raw)) return PROFILES[raw];

  console.warn(
    `TECHNOW_PROFILE="${raw}" 는 알 수 없는 프로필이라 기본값 ${DEFAULT_PROFILE} 을 씁니다`,
  );
  return PROFILES[DEFAULT_PROFILE];
}
