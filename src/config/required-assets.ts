/**
 * 발행에 필요한 자산.
 *
 * 여기 나열된 자산이 전부 있어야 기사가 ready 로 승격된다 (MASTER_PLAN §2.5).
 * Phase가 올라가며 늘어나므로 코드가 아니라 설정으로 둔다.
 *
 * 자산이 하나라도 빠지면 기사는 ready_pending 으로 남고, 그날 아침 발행에서
 * 제외된 뒤 다음 런에서 재시도된다. 공개 사이트에 반쪽 상태를 내보내지 않는다.
 */
export type Asset = 'english_body' | 'korean_translation' | 'cover_image';

export const ALL_ASSETS: readonly Asset[] = [
  'english_body',
  'korean_translation',
  'cover_image',
] as const;

/**
 * 현재 Phase의 필수 자산.
 *
 * Phase 3: english_body
 * Phase 4: + korean_translation  (로드맵 4.6)
 * Phase 5: + cover_image         (로드맵 5.4) ← 지금
 *
 * 여기에 자산을 더하면 새 기사는 `ready_pending` 으로 들어오고
 * `src/pipeline/fill-assets.ts` 가 그것을 채워야 `ready` 가 된다.
 * 못 채우면 그날 아침 발행에서 빠지고, 2회 연속이면 `failed` 다 (publish-ready.ts).
 */
export const requiredAssets: readonly Asset[] = [
  'english_body',
  'korean_translation',
  'cover_image',
] as const;

/**
 * 기사에 기록되는 스타일 가이드 버전 (`articles.style_guide_version`).
 *
 * 발행된 기사는 수정하지 않으므로(기획서 §9), 가이드를 고쳐도 기존 기사는 그대로 둔다.
 * 어떤 기사가 어떤 기준으로 쓰였는지는 이 값으로 안다.
 *
 * docs/STYLE_GUIDE.md §7 의 버전 표와 일치해야 한다.
 */
export const STYLE_GUIDE_VERSION = '2026-09-05b';
