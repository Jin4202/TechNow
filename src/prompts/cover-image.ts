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
 * **평면 벡터 일러스트 → 사진 품질로 바꿨다** (2026-09-06, D-52, 사용자 결정).
 *
 * ⚠️ D-38 은 사진 화풍을 **일부러 피했다**: "사진처럼 보이는 이미지는 실제 사건의
 * 사진으로 오해된다 — 우리 기사에는 실제 사진이 없다." 그 위험을 사용자에게
 * 제기했고 사용자가 사진 품질을 택했다. 위험은 없어지지 않았으므로 **카드에
 * 일러스트 표기를 붙여** 상쇄한다 (`components/article-card`).
 *
 * 바뀌지 않는 것 (CLAUDE.md §5 — 화풍의 문제가 아니다):
 *   - **글자 없음**: 아직 글자를 100% 정확히 쓰는 모델이 없다
 *   - **얼굴 없음**: 실존 인물 금지의 위험은 얼굴에서 온다. 사진 화풍에서는
 *     이 위험이 오히려 커진다 — 그럴듯한 얼굴은 실존 인물처럼 읽힌다
 *   - **로고·브랜드 없음**
 *
 * 사진 화풍에서 새로 필요해진 것:
 *   - **실제 사건의 기록처럼 보이지 않게** 한다. 기자회견장·사고 현장·특정
 *     실험실을 재현하면 "이것이 그 현장 사진" 으로 읽힌다. 연출된 정물·매크로·
 *     구조 사진은 그렇게 읽히지 않는다
 *   - 배경색을 못 박던 지시는 뺀다. 사진에서 단색 배경을 강요하면 스톡 이미지처럼
 *     된다. 대신 **일관된 조명과 톤**으로 목록의 통일감을 만든다
 */
export const STYLE_PREFIX = [
  'Editorial cover photograph for a science and technology magazine.',
  'Photorealistic, shot on a full-frame camera with a prime lens, shallow depth of field, fine detail and natural texture.',
  // 목록에 카드가 나란히 놓인다. 사진에서 통일감은 배경색이 아니라 조명이 만든다
  'Consistent look across the series: low-key studio lighting, deep cool shadows, a single warm key light, muted desaturated palette.',
  'A single clear subject, centred, with clean negative space around it.',
  // 아래 두 줄이 "실제 취재 사진" 오해를 막는다
  'A staged conceptual still life or a macro study of form, material, and structure — not documentary photography.',
  'No recognisable real place, no press conference, no news scene, no reconstruction of a real event.',
  'No text, no letters, no numbers, no logos, no watermarks, no signage.',
  // 사진 화풍에서 얼굴 위험이 커진다 — 그럴듯한 얼굴은 실존 인물처럼 읽힌다
  'No faces and no identifiable people. Figures may appear only as distant silhouettes, from behind, or cropped below the shoulders.',
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
