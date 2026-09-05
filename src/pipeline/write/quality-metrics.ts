import { BANNED_WORDS } from '@/config/style-checks';

/**
 * 기사 품질 지표 (평가 프레임워크).
 *
 * 순수 함수. 비용 0, 완전히 재현 가능.
 *
 * **기준 코퍼스와 우리 기사에 같은 함수를 쓴다.** 음절 계산 휴리스틱이
 * 정확하지 않아도 양쪽에 동일하게 적용되므로 비교는 성립한다.
 * 다른 함수로 재면 그 차이가 결과에 섞인다.
 *
 * 한국어에는 쓰지 않는다. Flesch 계열은 영어 음절 기반이라 번역본에 성립하지 않는다.
 */

// ── 통계 헬퍼 ──────────────────────────────────────────────

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 선형 보간 백분위. p 는 0~1 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;

  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;

  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/** 모집단 표준편차 */
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

// ── 텍스트 분해 ────────────────────────────────────────────

/**
 * 음절 수 휴리스틱.
 *
 * 모음군을 세고, 묵음 e 를 빼고, 최소 1. 정확하지 않다 —
 * "science"(2) 를 1로 세는 식의 오차가 있다. 일관성이 목적이다.
 */
export function countSyllables(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (clean.length === 0) return 0;
  if (clean.length <= 3) return 1;

  const groups = clean.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;

  // 묵음 e. 다만 "-le" 는 음절을 만든다 (table, simple)
  if (clean.endsWith('e') && !/[^aeiouy]le$/.test(clean)) count -= 1;
  // -ed 는 대개 음절을 만들지 않는다 (walked). -ted/-ded 는 만든다
  if (clean.endsWith('ed') && !/[td]ed$/.test(clean)) count -= 1;

  return Math.max(1, count);
}

/** 약어와 소수점을 문장 끝으로 오인하지 않게 나눈다 */
export function splitSentences(text: string): string[] {
  const guarded = text
    // 흔한 약어
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof|St|vs|etc|e\.g|i\.e|Fig|No|approx)\.\s/gi, '$1<DOT> ')
    // 소수점과 U.S. 같은 이니셜
    .replace(/(\d)\.(\d)/g, '$1<DOT>$2')
    .replace(/\b([A-Z])\.([A-Z])\./g, '$1<DOT>$2<DOT>');

  return guarded
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/<DOT>/g, '.').trim())
    .filter((s) => s.length > 0);
}

export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
}

// ── 지표 ───────────────────────────────────────────────────

export interface TextMetrics {
  /** 문장 */
  sentences: number;
  sentenceMean: number;
  sentenceMedian: number;
  sentenceP90: number;
  sentenceMax: number;
  /** 길이가 섞여 있는가. 균일하게 긴 글이 가장 읽기 나쁘다 */
  sentenceStdev: number;
  /** 40단어를 넘는 문장의 비율 (0~1) */
  longSentenceRatio: number;

  /** 어휘 */
  words: number;
  syllablesPerWord: number;
  /** 3음절 이상 단어 비율. 전문 어휘 밀도의 대리 지표 */
  polysyllabicRatio: number;

  /** 난이도. 높을수록 쉽다 (0~100) */
  fleschReadingEase: number;
  /** 미국 학년 기준. 낮을수록 쉽다 */
  fleschKincaidGrade: number;
}

export function textMetrics(text: string): TextMetrics {
  const sentences = splitSentences(text);
  const lengths = sentences.map((s) => splitWords(s).length).filter((n) => n > 0);
  const words = splitWords(text);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);

  const wordsPerSentence = lengths.length === 0 ? 0 : mean(lengths);
  const syllablesPerWord = words.length === 0 ? 0 : syllables / words.length;

  return {
    sentences: lengths.length,
    sentenceMean: wordsPerSentence,
    sentenceMedian: percentile(lengths, 0.5),
    sentenceP90: percentile(lengths, 0.9),
    sentenceMax: lengths.length === 0 ? 0 : Math.max(...lengths),
    sentenceStdev: stdev(lengths),
    longSentenceRatio:
      lengths.length === 0 ? 0 : lengths.filter((n) => n > 40).length / lengths.length,

    words: words.length,
    syllablesPerWord,
    polysyllabicRatio:
      words.length === 0 ? 0 : words.filter((w) => countSyllables(w) >= 3).length / words.length,

    fleschReadingEase: 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord,
    fleschKincaidGrade: 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59,
  };
}

// ── 위반 검사 ──────────────────────────────────────────────

export interface StyleViolations {
  bannedWords: string[];
  exclamations: number;
  rhetoricalQuestions: string[];
}

export function findViolations(text: string): StyleViolations {
  const lower = text.toLowerCase();

  return {
    bannedWords: BANNED_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(lower)),
    exclamations: (text.match(/!/g) ?? []).length,
    // 본문의 의문문은 대개 수사적 질문이다 (스타일 가이드가 금지한다)
    rhetoricalQuestions: splitSentences(text).filter((s) => s.endsWith('?')),
  };
}
