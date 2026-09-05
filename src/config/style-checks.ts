/**
 * 스타일 위반 검사에 쓰는 목록 (docs/STYLE_GUIDE.md §3).
 *
 * 프롬프트와 검사기가 같은 목록을 봐야 한다 — 프롬프트에서 금지한 단어와
 * 검사하는 단어가 다르면 어느 쪽이 기준인지 알 수 없다.
 */
export const BANNED_WORDS: readonly string[] = [
  'revolutionary',
  'groundbreaking',
  'game-changing',
  'game changing',
  'stunning',
  'incredible',
  'mind-blowing',
  'unprecedented',
  'breakthrough',
] as const;
