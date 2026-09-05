import { describe, expect, it, vi } from 'vitest';

import { budget } from '@/config/budget';
import { buildArticle, checkSourceRules } from '@/pipeline/write/build-article';

import type { AnthropicClient } from '@/clients/anthropic';
import type { PromptSource } from '@/prompts/grounded-steps';

const source = (ordinal: number, tier: 1 | 2 = 1): PromptSource => ({
  ordinal,
  url: `https://example.org/${ordinal}`,
  title: null,
  publisher: null,
  tier,
  text: '본문',
});

const threeSources = [source(1), source(2), source(3)];

describe('checkSourceRules (3.10)', () => {
  it('최소 출처 수를 채우면 통과', () => {
    expect(checkSourceRules(threeSources, 3)).toBeNull();
  });

  it('출처가 최소 수보다 적으면 거부', () => {
    const r = checkSourceRules([source(1), source(2)], 2);
    expect(r?.failure).toBe('too-few-sources');
  });

  it('Tier 1 후보가 있었는데 확보 못 하면 거부', () => {
    const tier2Only = [source(1, 2), source(2, 2), source(3, 2)];
    expect(checkSourceRules(tier2Only, 4)?.failure).toBe('no-tier1');
  });

  it('Tier 1 후보가 애초에 없었으면 Tier 2 만으로도 통과', () => {
    // "존재한다면" 이 조건이다. 없던 토픽까지 막으면 Tier 2 만 다루는
    // 분야가 통째로 사라진다
    const tier2Only = [source(1, 2), source(2, 2), source(3, 2)];
    expect(checkSourceRules(tier2Only, 0)).toBeNull();
  });

  it('최소 출처 수는 budget 설정을 따른다', () => {
    const justUnder = Array.from({ length: budget.minSources - 1 }, (_, i) => source(i + 1));
    expect(checkSourceRules(justUnder, 0)?.failure).toBe('too-few-sources');
  });
});

const goodDraft = {
  title: '제목',
  one_line_summary: '요약',
  category: 'ai-computing',
  tags: ['tag'],
  sections: [1, 2, 3].map((n) => ({
    heading: `섹션 ${n}`,
    paragraphs: ['문장 하나.'],
    sources: [n],
  })),
};

/**
 * 호출 순서: 작성 → 추출 → 대조 → (재작성 → 추출 → 대조)
 */
function stub(steps: (unknown | Error)[]): AnthropicClient {
  let call = 0;
  return {
    messages: {
      parse: vi.fn(async () => {
        const result = steps[call++];
        if (result instanceof Error) throw result;
        return { parsed_output: result, usage: { input_tokens: 10, output_tokens: 5 } };
      }),
    },
  } as unknown as AnthropicClient;
}

const claims = { claims: [{ text: 'A', kind: 'number', sectionIndex: 0 }] };
const allSupported = { verdicts: [{ claimIndex: 0, supported: true, sourceOrdinals: [1], note: '' }] };
const unsupported = { verdicts: [{ claimIndex: 0, supported: false, sourceOrdinals: [], note: '없음' }] };

describe('buildArticle (3.9)', () => {
  const input = { topicTitle: 'T', sources: threeSources, tier1CandidatesSeen: 3 };

  it('첫 시도에 통과하면 재작성하지 않는다', async () => {
    const claude = stub([goodDraft, claims, allSupported]);
    const r = await buildArticle(claude, input);

    expect(r.article).not.toBeNull();
    expect(r.attempts).toBe(1);
    expect(claude.messages.parse).toHaveBeenCalledTimes(3);
  });

  it('근거 실패 시 1회 재작성하고 통과하면 발행한다', async () => {
    const claude = stub([goodDraft, claims, unsupported, goodDraft, claims, allSupported]);
    const r = await buildArticle(claude, input);

    expect(r.article).not.toBeNull();
    expect(r.attempts).toBe(2);
  });

  it('재작성해도 실패하면 skip 한다', async () => {
    const claude = stub([goodDraft, claims, unsupported, goodDraft, claims, unsupported]);
    const r = await buildArticle(claude, input);

    expect(r.article).toBeNull();
    expect(r.failure).toBe('grounding-failed');
    expect(r.attempts).toBe(2);
    // 세 번째 시도는 없다
    expect(claude.messages.parse).toHaveBeenCalledTimes(6);
  });

  it('재작성 프롬프트에 근거 없는 진술이 들어간다', async () => {
    const claude = stub([goodDraft, claims, unsupported, goodDraft, claims, allSupported]);
    await buildArticle(claude, input);

    const fourthCall = vi.mocked(claude.messages.parse).mock.calls[3]![0] as {
      messages: { content: { text: string }[] }[];
    };
    const instructions = fourthCall.messages[0]!.content[1]!.text;
    expect(instructions).toContain('not supported by the sources');
    expect(instructions).toContain('Do not add new claims');
  });

  it('규격 위반도 사유를 붙여 재시도한다', async () => {
    // 섹션 2개짜리 초안 → 재작성 → 정상
    const badDraft = { ...goodDraft, sections: goodDraft.sections.slice(0, 2) };
    const claude = stub([badDraft, goodDraft, claims, allSupported]);
    const r = await buildArticle(claude, input);

    expect(r.article).not.toBeNull();
    expect(r.attempts).toBe(2);
  });

  it('출처 규칙 위반이면 모델을 부르지 않는다', async () => {
    const claude = stub([]);
    const r = await buildArticle(claude, {
      topicTitle: 'T',
      sources: [source(1)],
      tier1CandidatesSeen: 1,
    });

    expect(r.failure).toBe('too-few-sources');
    expect(r.attempts).toBe(0);
    expect(claude.messages.parse).not.toHaveBeenCalled();
  });

  it('검증 호출 실패는 근거 실패와 구분한다', async () => {
    const claude = stub([goodDraft, new Error('타임아웃'), goodDraft, new Error('타임아웃')]);
    const r = await buildArticle(claude, input);

    expect(r.article).toBeNull();
    expect(r.failure).toBe('verify-error');
  });

  it('두 시도의 토큰을 합산한다', async () => {
    const claude = stub([goodDraft, claims, unsupported, goodDraft, claims, allSupported]);
    const r = await buildArticle(claude, input);
    expect(r.usage.inputTokens).toBe(60); // 6회 × 10
  });
});
