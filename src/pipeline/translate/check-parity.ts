import { thresholds } from '@/config/thresholds';

import type { ArticleSection } from '@/pipeline/write/write-article';

/**
 * 번역본 구조 정합성 검증 (로드맵 4.3a, D-03).
 *
 * 순수 함수. "번역이 구조를 바꾸지 않는다" 는 제약을 코드로 만든 것이다.
 *
 * 구조가 어긋난 번역을 발행하면 섹션별 출처 표기(기획서 §2.2)가 틀린 문단을
 * 가리키게 된다. 독자에게는 근거가 있는 것처럼 보이지만 실제로는 없다.
 * 그래서 여기서 걸리면 번역 실패로 다루고, 기사는 한국어판 없이 발행되지 않는다 (4.6).
 */

export type ParityFailure =
  /** 섹션 수가 다르다 */
  | 'section-count'
  /** 섹션의 문단 수가 다르다 */
  | 'paragraph-count'
  /** 섹션이 가리키는 출처 번호가 다르다 */
  | 'sources-mismatch'
  /** 제목·요약·소제목이 비었다 */
  | 'empty-field'
  /** 번역되지 않았다 (영문이 그대로 돌아옴) */
  | 'not-translated';

export interface ParityProblem {
  failure: ParityFailure;
  detail: string;
}

interface ArticleShape {
  title: string;
  oneLineSummary: string;
  sections: readonly ArticleSection[];
}

/**
 * 문제가 없으면 `null`.
 *
 * 첫 번째 문제에서 멈춘다. 전부 모아 돌려줘도 대응은 재시도 하나뿐이고,
 * 재시도 프롬프트에는 고칠 것이 하나인 편이 낫다.
 */
export function checkParity(original: ArticleShape, translated: ArticleShape): ParityProblem | null {
  if (original.sections.length !== translated.sections.length) {
    return {
      failure: 'section-count',
      detail: `원문 ${original.sections.length}개, 번역 ${translated.sections.length}개`,
    };
  }

  if (!translated.title.trim() || !translated.oneLineSummary.trim()) {
    return { failure: 'empty-field', detail: '제목 또는 한 줄 요약이 비었다' };
  }

  for (const [index, source] of original.sections.entries()) {
    const target = translated.sections[index]!;

    if (!target.heading.trim()) {
      return { failure: 'empty-field', detail: `섹션 ${index + 1} 의 소제목이 비었다` };
    }

    if (source.paragraphs.length !== target.paragraphs.length) {
      return {
        failure: 'paragraph-count',
        detail: `섹션 ${index + 1}: 원문 ${source.paragraphs.length}문단, 번역 ${target.paragraphs.length}문단`,
      };
    }

    // 순서까지 같아야 한다. 같은 집합이어도 순서가 다르면 표기가 달라진다
    if (source.sources.join(',') !== target.sources.join(',')) {
      return {
        failure: 'sources-mismatch',
        detail: `섹션 ${index + 1}: 원문 [${source.sources.join(', ')}], 번역 [${target.sources.join(', ')}]`,
      };
    }
  }

  const ratio = hangulRatio(bodyText(translated));
  if (ratio < thresholds.minHangulRatio) {
    return {
      failure: 'not-translated',
      detail: `한글 비율 ${(ratio * 100).toFixed(1)}% (최소 ${(thresholds.minHangulRatio * 100).toFixed(0)}%)`,
    };
  }

  return null;
}

function bodyText(article: ArticleShape): string {
  return [
    article.title,
    article.oneLineSummary,
    ...article.sections.flatMap((s) => [s.heading, ...s.paragraphs]),
  ].join(' ');
}

/**
 * 글자 중 한글의 비율.
 *
 * 구조 검증만으로는 못 잡는 실패가 있다 — 모델이 영문을 그대로 돌려주는 경우다.
 * 구조는 완벽하게 일치하고 내용은 번역되지 않은 상태로 통과해버린다.
 *
 * 공백·숫자·문장부호는 세지 않는다. 고유명사와 용어 병기는 영문으로 남으므로
 * 정상적인 번역도 100% 가 되지 않는다 — 임계값은 그것을 감안한 값이다.
 */
export function hangulRatio(text: string): number {
  const letters = text.match(/[\p{Letter}]/gu) ?? [];
  if (letters.length === 0) return 0;

  const hangul = letters.filter((c) => /[\u{AC00}-\u{D7A3}\u{1100}-\u{11FF}]/u.test(c));
  return hangul.length / letters.length;
}
