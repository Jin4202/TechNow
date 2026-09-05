import { describe, expect, it } from 'vitest';

import {
  countSyllables,
  findViolations,
  mean,
  percentile,
  splitSentences,
  splitWords,
  stdev,
  textMetrics,
} from '@/pipeline/write/quality-metrics';

describe('통계 헬퍼', () => {
  it('평균', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(mean([])).toBe(0);
  });

  it('중앙값 (짝수 개는 보간)', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
  });

  it('p90', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1, 5);
  });

  it('값이 하나면 그 값', () => {
    expect(percentile([7], 0.9)).toBe(7);
  });

  it('표준편차', () => {
    // 모집단 표준편차: [2,4,4,4,5,5,7,9] → 2
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });

  it('값이 하나면 편차 0', () => {
    expect(stdev([5])).toBe(0);
  });
});

describe('countSyllables', () => {
  const cases: [string, number][] = [
    ['cat', 1],
    ['the', 1],
    ['water', 2],
    ['banana', 3],
    ['table', 2], // -le 는 음절을 만든다
    ['simple', 2],
    ['made', 1], // 묵음 e
    ['walked', 1], // -ed 는 음절이 아니다
    ['wanted', 2], // -ted 는 음절이다
    ['connectome', 3],
  ];

  for (const [word, expected] of cases) {
    it(`${word} → ${expected}`, () => {
      expect(countSyllables(word)).toBe(expected);
    });
  }

  it('빈 문자열은 0', () => {
    expect(countSyllables('')).toBe(0);
  });

  it('최소 1을 보장한다', () => {
    expect(countSyllables('rhythm')).toBeGreaterThanOrEqual(1);
  });
});

describe('splitSentences', () => {
  it('마침표로 나눈다', () => {
    expect(splitSentences('One. Two. Three.')).toHaveLength(3);
  });

  it('약어를 문장 끝으로 오인하지 않는다', () => {
    expect(splitSentences('Dr. Smith led the work. It took a year.')).toHaveLength(2);
  });

  it('소수점을 문장 끝으로 오인하지 않는다', () => {
    // 이걸 놓치면 "0.5 percent" 같은 수치가 많은 과학 기사의 문장 수가 부풀려진다
    expect(splitSentences('The chance was 0.5 percent. That is small.')).toHaveLength(2);
  });

  it('이니셜을 문장 끝으로 오인하지 않는다', () => {
    expect(splitSentences('The U.S. team published first. Others followed.')).toHaveLength(2);
  });

  it('물음표와 느낌표도 문장 끝이다', () => {
    expect(splitSentences('Why? Because. Wow!')).toHaveLength(3);
  });

  it('빈 입력', () => {
    expect(splitSentences('')).toEqual([]);
  });
});

describe('splitWords', () => {
  it('구두점만 있는 토큰은 세지 않는다', () => {
    expect(splitWords('one two — three')).toHaveLength(3);
  });
});

describe('textMetrics', () => {
  const text =
    'The team mapped the brain. They found 166,700 neurons in the male fly nervous system. ' +
    'A connectome is a complete wiring diagram of a brain, showing every cell and every connection between them.';

  const m = textMetrics(text);

  it('문장 수', () => {
    expect(m.sentences).toBe(3);
  });

  it('단어 수', () => {
    expect(m.words).toBeGreaterThan(30);
  });

  it('최장 문장을 잡는다', () => {
    expect(m.sentenceMax).toBeGreaterThan(m.sentenceMedian);
  });

  it('표준편차가 0보다 크다 (길이가 섞여 있다)', () => {
    expect(m.sentenceStdev).toBeGreaterThan(0);
  });

  it('균일한 길이는 표준편차 0', () => {
    // 균일하게 긴 글이 가장 읽기 나쁘다. 그걸 잡으려면 이 값이 의미가 있어야 한다
    const uniform = textMetrics('aa bb cc dd. ee ff gg hh. ii jj kk ll.');
    expect(uniform.sentenceStdev).toBe(0);
  });

  it('Flesch Reading Ease 가 상식적인 범위다', () => {
    expect(m.fleschReadingEase).toBeGreaterThan(0);
    expect(m.fleschReadingEase).toBeLessThan(100);
  });

  it('쉬운 글이 어려운 글보다 높은 점수를 받는다', () => {
    const easy = textMetrics('The cat sat. The dog ran. The sun is hot.');
    const hard = textMetrics(
      'Superconductivity emerges through unconventional pairing mechanisms characterised by anisotropic order parameters.',
    );
    expect(easy.fleschReadingEase).toBeGreaterThan(hard.fleschReadingEase);
    expect(easy.fleschKincaidGrade).toBeLessThan(hard.fleschKincaidGrade);
  });

  it('40단어 초과 비율', () => {
    const long = `${'word '.repeat(45)}. Short one.`;
    expect(textMetrics(long).longSentenceRatio).toBe(0.5);
  });

  it('3음절 이상 단어 비율', () => {
    const dense = textMetrics('Superconductivity enables unconventional connectivity.');
    expect(dense.polysyllabicRatio).toBeGreaterThan(0.5);
  });

  it('빈 입력에도 던지지 않는다', () => {
    expect(() => textMetrics('')).not.toThrow();
    expect(textMetrics('').sentences).toBe(0);
  });
});

describe('findViolations', () => {
  it('금지어를 찾는다', () => {
    expect(findViolations('This is a groundbreaking result.').bannedWords).toContain(
      'groundbreaking',
    );
  });

  it('단어 경계를 지킨다', () => {
    expect(findViolations('The ground was wet.').bannedWords).toEqual([]);
  });

  it('느낌표를 센다', () => {
    expect(findViolations('Wow! Really!').exclamations).toBe(2);
  });

  it('의문문을 수사적 질문으로 잡는다', () => {
    expect(findViolations('What if batteries never died? They do.').rhetoricalQuestions).toHaveLength(
      1,
    );
  });

  it('위반이 없으면 빈 결과', () => {
    const v = findViolations('The team measured a threefold increase.');
    expect(v.bannedWords).toEqual([]);
    expect(v.exclamations).toBe(0);
    expect(v.rhetoricalQuestions).toEqual([]);
  });
});
