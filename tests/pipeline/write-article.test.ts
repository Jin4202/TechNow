import { describe, expect, it } from 'vitest';

import { sentenceStats, validateDraft, wordCount } from '@/pipeline/write/write-article';
import { buildSourceBlock, GROUNDED_SYSTEM } from '@/prompts/grounded-steps';

import type { PromptSource } from '@/prompts/grounded-steps';

const section = (sources: number[]) => ({
  heading: 'What happened',
  paragraphs: ['A sentence.', 'Another sentence.'],
  sources,
});

const draft = (over: Record<string, unknown> = {}) => ({
  title: 'Fruit fly brain fully mapped',
  one_line_summary: 'The map shows every connection in a male fly brain.',
  category: 'health-biotech',
  tags: ['connectome', 'drosophila'],
  sections: [section([1]), section([2]), section([1, 3])],
  ...over,
});

describe('validateDraft', () => {
  it('정상 초안을 통과시킨다', () => {
    const r = validateDraft(draft(), [1, 2, 3]);
    expect('article' in r).toBe(true);
  });

  it('섹션이 3개 미만이면 거부', () => {
    const r = validateDraft(draft({ sections: [section([1]), section([2])] }), [1, 2]);
    expect('failure' in r && r.failure).toBe('bad-section-count');
  });

  it('섹션이 5개를 넘으면 거부', () => {
    const r = validateDraft(draft({ sections: Array(6).fill(section([1])) }), [1]);
    expect('failure' in r && r.failure).toBe('bad-section-count');
  });

  it('근거 없는 섹션을 거부한다', () => {
    // 근거 없는 섹션은 쓰지 않는다는 것이 D-03 의 요지다
    const r = validateDraft(draft({ sections: [section([1]), section([]), section([2])] }), [1, 2]);
    expect('failure' in r && r.failure).toBe('section-without-sources');
  });

  it('없는 출처 번호를 거부한다', () => {
    // DB 삽입 전에 잡아야 한다. 통과시키면 런이 죽는다
    const r = validateDraft(draft({ sections: [section([1]), section([9]), section([2])] }), [1, 2]);
    expect('failure' in r && r.failure).toBe('unknown-source-ordinal');
    expect('detail' in r && r.detail).toContain('9');
  });

  it('7종 밖 카테고리를 거부한다', () => {
    const r = validateDraft(draft({ category: 'quantum-cooking' }), [1, 2, 3]);
    expect('failure' in r && r.failure).toBe('unparsable');
  });

  it('필드가 빠지면 unparsable', () => {
    const r = validateDraft({ title: 'x' }, [1]);
    expect('failure' in r && r.failure).toBe('unparsable');
  });

  it('중복 출처 참조를 정리하고 정렬한다', () => {
    const r = validateDraft(draft({ sections: [section([3, 1, 3]), section([2]), section([1])] }), [1, 2, 3]);
    expect('article' in r && r.article.sections[0]!.sources).toEqual([1, 3]);
  });

  it('태그를 소문자로 다듬는다', () => {
    const r = validateDraft(draft({ tags: ['  Connectome ', 'NASA', ''] }), [1, 2, 3]);
    expect('article' in r && r.article.tags).toEqual(['connectome', 'nasa']);
  });

  it('빈 문단을 버린다', () => {
    const r = validateDraft(
      draft({ sections: [{ heading: 'H', paragraphs: ['A.', '  ', 'B.'], sources: [1] }, section([2]), section([3])] }),
      [1, 2, 3],
    );
    expect('article' in r && r.article.sections[0]!.paragraphs).toEqual(['A.', 'B.']);
  });
});

describe('wordCount', () => {
  it('문단의 단어를 센다', () => {
    const r = validateDraft(draft(), [1, 2, 3]);
    if (!('article' in r)) throw new Error('실패');
    expect(wordCount(r.article)).toBe(12); // 3 섹션 × ("A sentence." + "Another sentence.") = 12
  });
});

describe('buildSourceBlock (D-06)', () => {
  const source = (ordinal: number, text = '본문'): PromptSource => ({
    ordinal,
    url: `https://example.org/${ordinal}`,
    title: `제목 ${ordinal}`,
    publisher: '매체',
    tier: 1,
    text,
  });

  it('출처 번호를 붙인다', () => {
    const block = buildSourceBlock([source(1), source(2)]);
    expect(block).toContain('[SOURCE 1]');
    expect(block).toContain('[SOURCE 2]');
  });

  it('입력 순서와 무관하게 ordinal 순으로 정렬한다', () => {
    // 단계마다 순서가 달라지면 캐시 프리픽스가 깨진다
    const a = buildSourceBlock([source(1), source(2), source(3)]);
    const b = buildSourceBlock([source(3), source(1), source(2)]);
    expect(a).toBe(b);
  });

  it('같은 입력이면 항상 같은 문자열이다', () => {
    expect(buildSourceBlock([source(1)])).toBe(buildSourceBlock([source(1)]));
  });

  it('아주 긴 본문을 자른다', () => {
    const block = buildSourceBlock([source(1, 'z'.repeat(20_000))]);
    expect(block).toContain('z'.repeat(12_000));
    expect(block).not.toContain('z'.repeat(12_001));
  });

  it('tier 와 URL 을 넣는다', () => {
    const block = buildSourceBlock([source(1)]);
    expect(block).toContain('tier: 1');
    expect(block).toContain('url: https://example.org/1');
  });
});

describe('GROUNDED_SYSTEM (D-06)', () => {
  it('단계와 무관하게 참인 내용만 담는다', () => {
    // 단계별 지시가 system 에 들어가면 네 단계의 캐시 프리픽스가 즉시 깨진다
    expect(GROUNDED_SYSTEM).not.toMatch(/write the article|extract the claims|verify/i);
  });

  it('출처 밖 지식을 쓰지 말라는 지시가 있다', () => {
    expect(GROUNDED_SYSTEM).toMatch(/no other knowledge/i);
  });
});

describe('sentenceStats', () => {
  const make = (paragraphs: string[]) => ({
    title: 't',
    oneLineSummary: 's',
    category: 'ai-computing' as const,
    tags: [],
    sections: [{ heading: 'h', paragraphs, sources: [1] }],
  });

  it('문장 수와 평균을 센다', () => {
    const stats = sentenceStats(make(['One two three. Four five.']));
    expect(stats.count).toBe(2);
    expect(stats.averageWords).toBe(2.5);
  });

  it('40단어를 넘는 문장을 골라낸다', () => {
    const long = `${'word '.repeat(45)}.`;
    const stats = sentenceStats(make([`Short one. ${long}`]));
    expect(stats.overLimit).toHaveLength(1);
  });

  it('30~40단어 문장은 허용한다', () => {
    // 기관명·인명이 들어가면 흔하다. 억지로 쪼개면 오히려 읽기 나빠진다
    const stats = sentenceStats(make([`${'word '.repeat(35)}.`]));
    expect(stats.overLimit).toHaveLength(0);
    expect(stats.longest).toBe(36);
  });

  it('빈 기사에도 던지지 않는다', () => {
    expect(sentenceStats(make([])).count).toBe(0);
  });
});
