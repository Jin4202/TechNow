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
 * Phase 5: + cover_image         (로드맵 5.4)
 */
export const requiredAssets: readonly Asset[] = ['english_body'] as const;
