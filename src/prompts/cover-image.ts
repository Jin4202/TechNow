/**
 * 커버 이미지 프롬프트 (로드맵 5.2).
 *
 * 입력은 기사 제목과 한 줄 요약이다 (기획서 §2.4). 본문은 넣지 않는다 —
 * 커버는 기사를 설명하는 그림이 아니라 **기사를 가리키는 표지**다.
 *
 * **고정 스타일 프리픽스를 모든 프롬프트에 붙인다.** 목록 페이지에서 카드가
 * 여러 장 나란히 보이므로, 장마다 화풍이 다르면 사이트가 짜깁기처럼 보인다.
 *
 * 금지 사항은 CLAUDE.md §5 다. 부탁이 아니라 **프롬프트 조립 단계에서 거른다** —
 * 모델에게 "로고를 넣지 마세요" 라고 쓰는 것과, 로고를 부를 만한 단어를
 * 애초에 넣지 않는 것은 다르다.
 */

/**
 * 모든 커버가 공유하는 화풍.
 *
 * 선택의 이유:
 *   - **텍스트 없음**: Flux schnell 은 글자를 제대로 못 쓴다. 잘못 쓴 글자가
 *     박힌 커버는 없느니만 못하다 (기획서 §7 — "no text rendering needed for covers")
 *   - **얼굴 없음**: 실존 인물 금지(CLAUDE.md §5)의 위험은 얼굴에서 온다.
 *     실루엣·뒷모습·상체는 누구도 닮지 않는다 (D-38)
 *   - **사진이 아닌 일러스트**: 사진처럼 보이는 이미지는 실제 사건의 사진으로
 *     오해된다. 우리 기사에는 실제 사진이 없다
 */
export const STYLE_PREFIX = [
  'Editorial illustration for a science and technology news site.',
  'Flat vector illustration, geometric shapes, clean edges, calm composition.',
  // 배경색을 못 박는다. 1차 실측에서 "muted palette" 만으로는 크림색 배경이 나왔고,
  // 목록에 카드가 나란히 놓이면 한 장만 밝은 것이 바로 눈에 띈다
  'Deep navy background (#1e293b), slate grey shapes, one warm amber accent.',
  // "하나의 사물" 을 요구하면 비유·미래 장면(D-38 의 2·3번)을 그릴 수 없다.
  // 화면이 산만해지는 것만 막는다
  'A single clear focal point.',
  'No text, no letters, no numbers, no logos, no watermarks.',
  // 실존 인물 위험은 얼굴에서 온다 (CLAUDE.md §5). 얼굴이 없으면 사람이 있어도 된다 —
  // "이 연구가 삶을 어떻게 바꾸나" 를 사람 없이 그리기는 어렵다
  'No faces. Figures may appear as flat silhouettes, seen from behind, or cropped below the face.',
  'Not photorealistic. No 3D render, no shading gradients, no lens flare, no stock-photo look.',
].join(' ');

/**
 * 프롬프트에서 걸러내는 것.
 *
 * 제목과 요약은 기사에서 오므로 기관명·인명·제품명이 그대로 들어 있다.
 * 그것을 이미지 모델에 넘기면 로고나 인물 초상이 나온다 (CLAUDE.md §5).
 */
const BRAND_HINTS =
  /\b(google|openai|anthropic|apple|microsoft|meta|nvidia|tesla|spacex|amazon|samsung|intel|ibm|nasa|esa|deepmind|boeing|huawei)\b/gi;

/** 사람 이름처럼 생긴 것 — 대문자로 시작하는 두 단어가 붙어 있는 형태 */
const NAME_LIKE = /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g;

/**
 * 고유명사를 지운다.
 *
 * 지우기만 하고 대체하지 않는다. "Google 이 발표한 양자 칩" 에서 Google 을 빼면
 * "양자 칩" 이 남고, 그것이 그림에 필요한 전부다.
 */
export function stripProperNouns(text: string): string {
  return text
    .replace(BRAND_HINTS, '')
    .replace(NAME_LIKE, '')
    .replace(/["'“”‘’]/g, '')
    // 고유명사를 지우면 공백과 구두점이 남는다
    .replace(/\s+([,.])/g, '$1')
    .replace(/([,.])\s*\1+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 최종 프롬프트.
 *
 * 장면은 기사를 읽은 쪽이 고른다 (`chooseCoverConcept`, D-38). 여기서는
 * 그 장면에 화풍을 입힐 뿐이다 — 기사 제목을 이미지 모델에 넘기던 방식은
 * 개념 기사에서 색면을 냈다 (D-37).
 *
 * 순서가 중요하다: 스타일이 먼저, 장면이 나중이다. 이미지 모델은 앞쪽 토큰에
 * 더 크게 반응하므로, 장면을 앞에 두면 기사마다 화풍이 흔들린다.
 *
 * 장면 설명에도 `subjectLine` 의 필터를 건다. 고유명사를 쓰지 말라고 지시했지만
 * 지시는 압력이지 보장이 아니다 (D-27).
 */
export function buildCoverPrompt(scene: string): string {
  return `${STYLE_PREFIX} ${stripProperNouns(scene)}`;
}
