/**
 * 배포 없이 바꿀 수 있는 설정값 (CLAUDE.md §2.4, 로드맵 2.6).
 *
 * 상수는 코드에 두되, 환경변수로 덮어쓸 수 있게 한다.
 * Trigger.dev 환경변수는 **재배포 없이** 바뀌므로, 캘리브레이션(2.8) 중에
 * 임계값을 조정할 때 배포를 기다릴 필요가 없다.
 *
 * 값을 읽는 시점에 평가한다 — 모듈 로드 시 한 번 읽고 캐시하면
 * 같은 워커가 살아 있는 동안 변경이 반영되지 않는다.
 */

/** 잘못된 값은 조용히 무시하고 기본값을 쓴다. 오타로 파이프라인이 멈추면 안 된다 */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    console.warn(`${name}="${raw}" 를 숫자로 읽을 수 없어 기본값 ${fallback} 을 씁니다`);
    return fallback;
  }
  return parsed;
}

export function envInt(name: string, fallback: number): number {
  const value = envNumber(name, fallback);
  return Math.round(value);
}
