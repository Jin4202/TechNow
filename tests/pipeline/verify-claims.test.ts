import { describe, expect, it, vi } from 'vitest';

import { buildRetryNote, verifyArticle } from '@/pipeline/verify/verify-claims';
import { buildExtractPrompt, buildVerifyPrompt } from '@/prompts/verify-claims';

import type { AnthropicClient } from '@/clients/anthropic';
import type { WrittenArticle } from '@/pipeline/write/write-article';
import type { PromptSource } from '@/prompts/grounded-steps';

const article: WrittenArticle = {
  title: '제목',
  oneLineSummary: '요약',
  category: 'ai-computing',
  tags: [],
  sections: [
    { heading: 'A', paragraphs: ['첫 문단.'], sources: [1] },
    { heading: 'B', paragraphs: ['둘째 문단.'], sources: [2] },
  ],
};

const sources: PromptSource[] = [1, 2].map((ordinal) => ({
  ordinal,
  url: `https://example.org/${ordinal}`,
  title: null,
  publisher: null,
  tier: 1,
  text: '본문',
}));

const claim = (text: string) => ({ text, kind: 'number' as const, sectionIndex: 0 });

/** 추출 호출과 대조 호출을 순서대로 흉내낸다 */
function stub(
  extract: { claims: unknown[] } | Error,
  verify?: { verdicts: unknown[] } | Error,
): AnthropicClient {
  let call = 0;
  return {
    messages: {
      parse: vi.fn(async () => {
        const result = call++ === 0 ? extract : verify;
        if (result instanceof Error) throw result;
        return { parsed_output: result, usage: { input_tokens: 10, output_tokens: 5 } };
      }),
    },
  } as unknown as AnthropicClient;
}

describe('verifyArticle', () => {
  it('전부 근거가 있으면 통과', async () => {
    const r = await verifyArticle(
      stub(
        { claims: [claim('5 million cells'), claim('published in 2026')] },
        {
          verdicts: [
            { claimIndex: 0, supported: true, sourceOrdinals: [1], note: 'ok' },
            { claimIndex: 1, supported: true, sourceOrdinals: [2], note: 'ok' },
          ],
        },
      ),
      article,
      sources,
    );

    expect(r.passed).toBe(true);
    expect(r.unsupported).toHaveLength(0);
    expect(r.error).toBeNull();
  });

  it('근거 없는 진술 하나가 발행을 막는다', async () => {
    const r = await verifyArticle(
      stub(
        { claims: [claim('사실'), claim('지어낸 숫자')] },
        {
          verdicts: [
            { claimIndex: 0, supported: true, sourceOrdinals: [1], note: 'ok' },
            { claimIndex: 1, supported: false, sourceOrdinals: [], note: '출처에 없음' },
          ],
        },
      ),
      article,
      sources,
    );

    expect(r.passed).toBe(false);
    expect(r.unsupported).toHaveLength(1);
    expect(r.unsupported[0]!.claim.text).toBe('지어낸 숫자');
  });

  it('판정을 받지 못한 진술은 근거 없음으로 본다', async () => {
    // 검증을 건너뛴 진술이 통과로 처리되면 검증 단계가 무의미해진다
    const r = await verifyArticle(
      stub(
        { claims: [claim('A'), claim('B'), claim('C')] },
        { verdicts: [{ claimIndex: 0, supported: true, sourceOrdinals: [1], note: 'ok' }] },
      ),
      article,
      sources,
    );

    expect(r.passed).toBe(false);
    expect(r.unsupported).toHaveLength(2);
    expect(r.unsupported[0]!.note).toBe('판정 없음');
  });

  it('존재하지 않는 출처를 근거로 들면 근거가 아니다', async () => {
    const r = await verifyArticle(
      stub(
        { claims: [claim('A')] },
        { verdicts: [{ claimIndex: 0, supported: true, sourceOrdinals: [9], note: 'ok' }] },
      ),
      article,
      sources,
    );

    expect(r.passed).toBe(false);
    expect(r.unsupported[0]!.note).toContain('존재하지 않음');
  });

  it('supported 인데 출처를 하나도 못 대면 근거가 아니다', async () => {
    const r = await verifyArticle(
      stub(
        { claims: [claim('A')] },
        { verdicts: [{ claimIndex: 0, supported: true, sourceOrdinals: [], note: '' }] },
      ),
      article,
      sources,
    );
    expect(r.passed).toBe(false);
  });

  it('추출된 진술이 0개면 실패로 본다', async () => {
    // 사실을 담은 기사에 검증 가능한 진술이 0개일 수는 없다.
    // 통과시키면 추출 실패가 검증 통과로 둔갑한다
    const r = await verifyArticle(stub({ claims: [] }), article, sources);
    expect(r.passed).toBe(false);
    expect(r.error).toBe('추출된 진술이 없음');
  });

  it('추출 호출이 실패하면 통과시키지 않는다', async () => {
    const r = await verifyArticle(stub(new Error('레이트 리밋')), article, sources);
    expect(r.passed).toBe(false);
    expect(r.error).toContain('클레임 추출 실패');
  });

  it('대조 호출이 실패하면 통과시키지 않는다', async () => {
    const r = await verifyArticle(
      stub({ claims: [claim('A')] }, new Error('타임아웃')),
      article,
      sources,
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('대조 실패');
  });

  it('토큰 사용량을 두 호출에서 합산한다', async () => {
    const r = await verifyArticle(
      stub(
        { claims: [claim('A')] },
        { verdicts: [{ claimIndex: 0, supported: true, sourceOrdinals: [1], note: 'ok' }] },
      ),
      article,
      sources,
    );
    expect(r.usage.inputTokens).toBe(20);
  });
});

describe('buildRetryNote', () => {
  it('근거 없는 진술과 사유를 나열한다', () => {
    const note = buildRetryNote([
      { claim: claim('숫자 42'), supported: false, sourceOrdinals: [], note: '출처는 41이라고 함' },
    ]);
    expect(note).toContain('숫자 42');
    expect(note).toContain('출처는 41이라고 함');
  });

  it('사유가 비면 기본 문구를 쓴다', () => {
    const note = buildRetryNote([
      { claim: claim('X'), supported: false, sourceOrdinals: [], note: '' },
    ]);
    expect(note).toContain('출처에서 확인되지 않음');
  });
});

describe('프롬프트', () => {
  it('추출 프롬프트에 섹션 번호가 들어간다', () => {
    const p = buildExtractPrompt(article);
    expect(p).toContain('[SECTION 0] A');
    expect(p).toContain('[SECTION 1] B');
  });

  it('대조 프롬프트가 표기 차이를 지원으로 인정한다', () => {
    // 3.8 완료 기준: 표기만 다른 참값은 걸리면 안 된다
    const p = buildVerifyPrompt([claim('5 million')]);
    expect(p).toContain('5,000,000');
    expect(p).toContain('The wording does not have to match');
  });

  it('대조 프롬프트가 상관관계를 인과로 쓰는 것을 막는다', () => {
    expect(buildVerifyPrompt([])).toContain('only show correlation');
  });

  it('대조 프롬프트가 hedge 누락을 잡도록 한다', () => {
    expect(buildVerifyPrompt([])).toContain('drops a hedge');
  });

  it('진술에 번호를 붙인다', () => {
    const p = buildVerifyPrompt([claim('A'), claim('B')]);
    expect(p).toContain('[0] (number) A');
    expect(p).toContain('[1] (number) B');
  });
});
