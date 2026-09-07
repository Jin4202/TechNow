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
 * **평면 벡터 → 사진 → 시네마틱 3D 렌더** (2026-09-06, D-52, 사용자 결정 두 번).
 *
 * 사진 화풍을 한 번 돌려보고 5장을 함께 본 뒤 방향을 다시 잡았다. 사물이 주인공인
 * 주제(위성·엔진·분자)에서는 잘 나왔지만 **풍경이 주제이면 다큐멘터리 사진으로
 * 무너졌다** — 조류인플루엔자 기사에서 갈라진 뻘·창고·새 떼가 나왔고 실제 취재
 * 사진과 구분되지 않았다. `no news scene` 지시를 넣었는데도 그랬다. 지시는
 * 압력이지 보장이 아니다 (D-27).
 *
 * 사용자가 고른 방향은 **가장 잘 나온 두 장을 닮게** 하는 것이다 — 초파리 커넥톰의
 * 발광 네트워크, DNA 가닥의 3D 렌더. 둘 다 "사진일 리 없는" 이미지였다.
 * 그래서 화풍을 사진이 아니라 **명백한 CGI 렌더**로 못 박는다.
 *
 * **이것이 D-38 의 우려를 구조적으로 해결한다.** 사진처럼 보이지 않으면 실제 사건의
 * 사진으로 오해될 일이 없다. 표기(카드 배지·기사 캡션)는 그대로 두지만,
 * 이제 표기가 유일한 방어선이 아니다.
 *
 * 바뀌지 않는 것 (CLAUDE.md §5 — 화풍의 문제가 아니다):
 * 글자 없음, 얼굴 없음, 로고 없음.
 */
export const STYLE_PREFIX = [
  'Cinematic 3D render for a science and technology news site.',
  'High-end CGI: physically based materials, volumetric light, glowing emissive accents, subsurface scattering, fine surface detail, shallow depth of field.',
  // 이 한 줄이 다큐 사진으로 새는 것을 막는 핵심이다. "사진이 아니다" 가 아니라
  // "명백히 렌더다" 라고 적극적으로 말한다 — 부정형 지시보다 잘 지켜진다
  'Unmistakably a computer-generated render: luminous, slightly heightened, more vivid than reality. Never looks like a photograph.',
  // 목록에 카드가 나란히 놓인다. 통일감은 배경색이 아니라 조명과 톤이 만든다
  'Consistent look across the series: dark desaturated background, deep cool shadows, one warm amber key light, glowing highlights.',
  'A single clear subject, centred, with clean negative space around it.',
  // 풍경 주제에서 무너진 자리. 렌더 지시와 겹쳐서 이중으로 막는다
  'No documentary or press photography, no real location, no reconstruction of a real event.',
  'No text, no letters, no numbers, no logos, no watermarks, no signage.',
  // 렌더 화풍에서도 얼굴은 금지다. 사실적인 얼굴은 실존 인물처럼 읽힌다
  'No faces and no identifiable people. Figures may appear only as stylised silhouettes, from behind, or cropped below the shoulders.',
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
