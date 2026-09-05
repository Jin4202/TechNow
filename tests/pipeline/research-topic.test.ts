import { describe, expect, it, vi } from 'vitest';

import { budget } from '@/config/budget';
import { createFetchContext } from '@/pipeline/research/fetch-page';
import { generateQueries, researchTopic } from '@/pipeline/research/research-topic';
import { buildQueryPrompt } from '@/prompts/generate-queries';

import type { AnthropicClient } from '@/clients/anthropic';
import type { BraveClient } from '@/clients/brave';

const topic = {
  title: 'Fruit fly brain fully mapped',
  items: [{ title: 'Fly connectome complete', description: '설명' }],
};

const ARTICLE = (n = 25) =>
  `<!doctype html><html><head><title>원문</title></head><body><article><p>${
    'The researchers reported a complete wiring diagram of the fly brain. '.repeat(n)
  }</p></article></body></html>`;

function claudeStub(queries: string[] | Error): AnthropicClient {
  return {
    messages: {
      parse: vi.fn(async () => {
        if (queries instanceof Error) throw queries;
        return { parsed_output: { queries }, usage: { input_tokens: 20, output_tokens: 10 } };
      }),
    },
  } as unknown as AnthropicClient;
}

function braveStub(urlsPerQuery: string[][] | Error): BraveClient {
  let call = 0;
  return {
    search: vi.fn(async () => {
      if (urlsPerQuery instanceof Error) throw urlsPerQuery;
      const urls = urlsPerQuery[call++] ?? [];
      return urls.map((url) => ({ url, title: 't', description: 'd' }));
    }),
  } as unknown as BraveClient;
}

function fetchStub(behaviour: Record<string, 'ok' | 'fail' | 'sponsored'>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });

    const key = Object.keys(behaviour).find((k) => url.includes(k));
    const mode = key ? behaviour[key] : 'ok';

    if (mode === 'fail') return new Response('nope', { status: 500 });
    const body =
      mode === 'sponsored'
        ? ARTICLE().replace('<p>', '<p>This article is brought to you by AcmeCorp. ')
        : ARTICLE();
    return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

describe('generateQueries', () => {
  it('모델이 준 쿼리를 쓴다', async () => {
    const { queries } = await generateQueries(claudeStub(['a', 'b']), topic);
    expect(queries).toEqual(['a', 'b']);
  });

  it('토픽당 검색 상한만큼만 남긴다 (CLAUDE.md §2.6)', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `q${i}`);
    const { queries } = await generateQueries(claudeStub(many), topic);
    expect(queries).toHaveLength(budget.searchCallsPerTopic);
  });

  it('빈 쿼리는 버린다', async () => {
    const { queries } = await generateQueries(claudeStub(['  ', 'real']), topic);
    expect(queries).toEqual(['real']);
  });

  it('모델이 실패해도 조사를 포기하지 않고 제목으로 검색한다', async () => {
    const { queries } = await generateQueries(claudeStub(new Error('레이트 리밋')), topic);
    expect(queries).toEqual(['Fruit fly brain fully mapped']);
  });

  it('결과가 비어도 제목으로 폴백', async () => {
    const { queries } = await generateQueries(claudeStub([]), topic);
    expect(queries).toHaveLength(1);
  });
});

describe('researchTopic', () => {
  const good = [
    'https://www.nature.com/articles/a',
    'https://news.mit.edu/b',
    'https://www.reuters.com/c',
    'https://arstechnica.com/d',
    'https://www.bbc.com/e',
    'https://www.npr.org/f',
  ];

  it('출처를 모으고 tier 를 붙인다', async () => {
    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([good]),
      createFetchContext(fetchStub({})),
      topic,
    );

    expect(r.skipped).toBeNull();
    expect(r.sources).toHaveLength(budget.maxSources);
    // Tier 1 이 앞에 온다 (3.10 대비)
    expect(r.sources[0]!.tier).toBe(1);
    expect(r.sources.every((s) => s.text.length > 0)).toBe(true);
  });

  it('5개를 모으면 더 가져오지 않는다', async () => {
    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([good]),
      createFetchContext(fetchStub({})),
      topic,
    );
    // 6개 후보 중 5개만 fetch
    expect(r.pagesFetched).toBe(budget.maxSources);
  });

  it('실패한 페이지는 건너뛰고 다음 후보로 간다', async () => {
    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([good]),
      createFetchContext(fetchStub({ 'nature.com': 'fail' })),
      topic,
    );
    expect(r.sources).toHaveLength(budget.maxSources);
    expect(r.rejections.some((x) => x.url.includes('nature.com'))).toBe(true);
  });

  it('협찬 기사는 출처로 쓰지 않는다', async () => {
    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([good]),
      createFetchContext(fetchStub({ 'mit.edu': 'sponsored' })),
      topic,
    );
    expect(r.sources.some((s) => s.url.includes('mit.edu'))).toBe(false);
    expect(r.rejections.some((x) => x.reason === 'sponsored')).toBe(true);
  });

  it('쓸 만한 도메인이 없으면 no-usable-candidates', async () => {
    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([['https://phys.org/x', 'https://www.reddit.com/y']]),
      createFetchContext(fetchStub({})),
      topic,
    );
    expect(r.skipped).toBe('no-usable-candidates');
    expect(r.pagesFetched).toBe(0);
  });

  it('최소 출처 수를 못 채우면 too-few-sources', async () => {
    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([['https://www.nature.com/a', 'https://www.reuters.com/b']]),
      createFetchContext(fetchStub({ 'nature.com': 'fail' })),
      topic,
    );
    expect(r.sources).toHaveLength(1);
    expect(r.skipped).toBe('too-few-sources');
  });

  it('검색이 실패해도 나머지 쿼리로 진행한다', async () => {
    let call = 0;
    const brave = {
      search: vi.fn(async () => {
        if (call++ === 0) throw new Error('일시 오류');
        return good.map((url) => ({ url, title: 't', description: 'd' }));
      }),
    } as unknown as BraveClient;

    const r = await researchTopic(
      claudeStub(['q1', 'q2']),
      brave,
      createFetchContext(fetchStub({})),
      topic,
    );
    expect(r.searchCalls).toBe(1);
    expect(r.sources.length).toBeGreaterThan(0);
  });

  it('여러 쿼리에서 나온 같은 URL 을 한 번만 센다', async () => {
    const r = await researchTopic(
      claudeStub(['q1', 'q2']),
      braveStub([good.slice(0, 3), good.slice(0, 3)]),
      createFetchContext(fetchStub({})),
      topic,
    );
    expect(r.sources).toHaveLength(3);
    expect(r.pagesFetched).toBe(3);
  });

  it('페이지 fetch 상한을 넘지 않는다', async () => {
    // 전부 실패시켜 후보를 소진하게 한다
    const many = Array.from({ length: 30 }, (_, i) => `https://sub${i}.example.edu/a`);
    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([many]),
      createFetchContext(fetchStub({ 'example.edu': 'fail' })),
      topic,
    );
    expect(r.pagesFetched).toBe(budget.pagesPerTopic);
  });
});

describe('buildQueryPrompt', () => {
  it('토픽과 항목을 넣는다', () => {
    const p = buildQueryPrompt({ topicTitle: 'T', items: [{ title: 'I', description: 'D' }] });
    expect(p).toContain('Topic: T');
    expect(p).toContain('- I');
  });

  it('긴 설명을 400자로 자른다', () => {
    const p = buildQueryPrompt({
      topicTitle: 'T',
      items: [{ title: 'I', description: 'w'.repeat(900) }],
    });
    expect(p).not.toContain('w'.repeat(401));
  });
});
