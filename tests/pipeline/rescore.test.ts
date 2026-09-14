import { describe, expect, it, vi } from 'vitest';

import { thresholds } from '@/config/thresholds';
import { rescoreTopics, selectForRescore } from '@/pipeline/score/rescore';
import { createFetchContext } from '@/pipeline/research/fetch-page';
import { buildRescorePrompt } from '@/prompts/score-topics';

import type { AnthropicClient } from '@/clients/anthropic';
import type { ScoredTopic } from '@/pipeline/score/score-topics';

describe('selectForRescore (D-19)', () => {
  const t = (index: number, total: number) => ({ index, total });

  it('1차 점수 상위 N개를 고른다', () => {
    const scored = [t(0, 7), t(1, 13), t(2, 9), t(3, 11), t(4, 15)];
    expect(selectForRescore(scored, 3).map((s) => s.total)).toEqual([15, 13, 11]);
  });

  it('대상이 N개보다 적으면 전부 고른다', () => {
    expect(selectForRescore([t(0, 9), t(1, 12)], 5)).toHaveLength(2);
  });

  it('동점이면 먼저 온 순서를 유지한다 (결정적)', () => {
    const scored = [t(10, 12), t(11, 12), t(12, 12)];
    expect(selectForRescore(scored, 2).map((s) => s.index)).toEqual([10, 11]);
  });

  it('빈 입력은 빈 결과', () => {
    expect(selectForRescore([], 5)).toEqual([]);
  });

  it('밴드와 달리 대상 수가 분포에 흔들리지 않는다', () => {
    // 점수가 몰려 있어도 상위 N개만 본다. 밴드 방식은 여기서 폭증했다
    const clustered = Array.from({ length: 100 }, (_, i) => t(i, 10));
    expect(selectForRescore(clustered, 9)).toHaveLength(9);
  });

  it('기본값은 상한의 3배다', () => {
    // 재채점이 점수를 낮출 수 있으므로 여유를 둔다
    expect(thresholds.rescoreTopN).toBe(thresholds.dailyCap * 3);
  });
});

const scored = (index: number, n: number, i: number, r: number): ScoredTopic => ({
  index,
  kind: 'paper' as const,
  category: 'physics-materials' as const,
  novelty: { score: n, reason: '1차 근거' },
  impact: { score: i, reason: '1차 근거' },
  interest: { score: r, reason: '1차 근거' },
  total: n + i + r,
});

const ARTICLE = `<!doctype html><html><head><title>원문 제목</title></head><body><article>
  <p>${'The team measured a threefold increase in device efficiency under laboratory conditions. '.repeat(20)}</p>
</article></body></html>`;

function stubFetch(html: string | null): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (html === null) return new Response('nope', { status: 500 });
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

function stubClient(result: unknown | Error): AnthropicClient {
  return {
    messages: {
      parse: vi.fn(async () => {
        if (result instanceof Error) throw result;
        return { parsed_output: result, usage: { input_tokens: 100, output_tokens: 50 } };
      }),
    },
  } as unknown as AnthropicClient;
}

const axis = (score: number, reason = '재채점 근거') => ({ score, reason });

describe('rescoreTopics', () => {
  it('원문을 읽고 점수를 갱신한다', async () => {
    const client = stubClient({
      scores: [{ topicNumber: 1, novelty: axis(5), impact: axis(4), interest: axis(4) }],
    });
    const { outcomes, pagesFetched, usage } = await rescoreTopics(
      client,
      createFetchContext(stubFetch(ARTICLE)),
      [{ score: scored(7, 3, 3, 3), title: 'T', triggerUrl: 'https://example.org/a' }],
    );

    expect(pagesFetched).toBe(1);
    expect(outcomes[0]!.rescored).toBe(true);
    expect(outcomes[0]!.before.total).toBe(9);
    expect(outcomes[0]!.after.total).toBe(13);
    expect(outcomes[0]!.after.index, '인덱스는 유지된다').toBe(7);
    expect(usage.inputTokens).toBe(100);
  });

  it('fetch 가 실패하면 1차 점수를 그대로 쓴다', async () => {
    const client = stubClient({ scores: [] });
    const { outcomes, pagesFetched } = await rescoreTopics(
      client,
      createFetchContext(stubFetch(null)),
      [{ score: scored(0, 3, 3, 4), title: 'T', triggerUrl: 'https://example.org/a' }],
    );

    expect(pagesFetched).toBe(0);
    expect(outcomes[0]!.rescored).toBe(false);
    expect(outcomes[0]!.reason).toContain('fetch 실패');
    // 토픽을 버리지 않는다
    expect(outcomes[0]!.after).toEqual(outcomes[0]!.before);
  });

  it('모델 호출이 실패해도 토픽을 버리지 않는다', async () => {
    const client = stubClient(new Error('레이트 리밋'));
    const { outcomes } = await rescoreTopics(
      client,
      createFetchContext(stubFetch(ARTICLE)),
      [{ score: scored(0, 4, 3, 3), title: 'T', triggerUrl: 'https://example.org/a' }],
    );

    expect(outcomes[0]!.rescored).toBe(false);
    expect(outcomes[0]!.after.total).toBe(10);
  });

  it('범위 밖 점수를 조인다', async () => {
    const client = stubClient({
      scores: [{ topicNumber: 1, novelty: axis(9), impact: axis(-2), interest: axis(3) }],
    });
    const { outcomes } = await rescoreTopics(
      client,
      createFetchContext(stubFetch(ARTICLE)),
      [{ score: scored(0, 3, 3, 3), title: 'T', triggerUrl: 'https://example.org/a' }],
    );
    expect(outcomes[0]!.after.novelty.score).toBe(5);
    expect(outcomes[0]!.after.impact.score).toBe(1);
  });

  it('robots.txt 가 막으면 fetch 하지 않는다', async () => {
    const blocking = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nDisallow: /', { status: 200 });
      }
      throw new Error('여기 오면 안 된다');
    }) as typeof fetch;

    const { outcomes, pagesFetched } = await rescoreTopics(
      stubClient({ scores: [] }),
      createFetchContext(blocking),
      [{ score: scored(0, 3, 3, 4), title: 'T', triggerUrl: 'https://example.org/a' }],
    );

    expect(pagesFetched).toBe(0);
    expect(outcomes[0]!.reason).toContain('robots-disallowed');
  });
});

describe('buildRescorePrompt', () => {
  const base = {
    title: 'T',
    firstPass: { novelty: 3, impact: 3, interest: 4 },
    articleTitle: '원문 제목',
    articleText: '본문',
  };

  it('1차 점수를 알려준다', () => {
    const p = buildRescorePrompt(base);
    expect(p).toContain('novelty 3, impact 3, interest 4');
  });

  it('자기 자신과 같은 점수도 정답임을 알린다', () => {
    // 이 문장이 없으면 모델이 변화를 만들어내려 한다
    expect(buildRescorePrompt(base)).toContain('agreeing with yourself is a valid outcome');
  });

  it('본문을 6000자로 자른다', () => {
    const p = buildRescorePrompt({ ...base, articleText: 'z'.repeat(9000) });
    expect(p).toContain('z'.repeat(6000));
    expect(p).not.toContain('z'.repeat(6001));
  });

  it('follow-up 이면 원본 기사 제목을 넣는다', () => {
    const p = buildRescorePrompt({ ...base, followUpOfTitle: '이전 기사' });
    expect(p).toContain('"이전 기사"');
  });
});
