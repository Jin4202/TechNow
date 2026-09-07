import { describe, expect, it, vi } from 'vitest';

import { budget } from '@/config/budget';
import { createFetchContext } from '@/pipeline/research/fetch-page';
import {
  generateQueries,
  hasRecentSource,
  researchTopic,
} from '@/pipeline/research/research-topic';
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

function braveStub(
  urlsPerQuery: string[][] | Error,
  /** URL 별 발행일. 없으면 null 이고, 그러면 신선도 판정이 통과시킨다 */
  dates: Record<string, Date> = {},
): BraveClient {
  let call = 0;
  return {
    search: vi.fn(async () => {
      if (urlsPerQuery instanceof Error) throw urlsPerQuery;
      const urls = urlsPerQuery[call++] ?? [];
      return urls.map((url) => ({
        url,
        title: 't',
        description: 'd',
        publishedAt: dates[url] ?? null,
      }));
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

  it('출처가 전부 오래되면 페이지를 가져오기 전에 끊는다 (D-51)', async () => {
    // 날짜는 실제 sorbitol 토픽에서 관측한 값이다 — 최신이 약 2.5개월 전
    const stale = Object.fromEntries(
      good.map((url, i) => [url, new Date(['2025-10-28', '2025-12-09', '2026-06-19',
        '2026-02-06', '2025-11-25', '2026-06-01'][i]!)]),
    );
    const fetchImpl = vi.fn(fetchStub({}));

    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([good], stale),
      createFetchContext(fetchImpl as unknown as typeof fetch),
      { title: 'T', items: [] },
    );

    expect(r.skipped).toBe('stale-topic');
    expect(r.sources).toHaveLength(0);
    // **페이지를 한 장도 가져오지 않아야 한다.** 가져온 뒤 버리면 그만큼이 그냥 나간 돈이다
    expect(r.pagesFetched).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('오래된 출처가 섞여 있어도 하나가 최근이면 진행한다 (D-51)', async () => {
    const mixed = { [good[0]!]: new Date('2018-03-05'), [good[1]!]: new Date() };

    const r = await researchTopic(
      claudeStub(['q1']),
      braveStub([good], mixed),
      createFetchContext(fetchStub({})),
      { title: 'T', items: [] },
    );

    expect(r.skipped).not.toBe('stale-topic');
    expect(r.sources.length).toBeGreaterThan(0);
  });

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

/**
 * 토픽 신선도 (D-51).
 *
 * 날짜는 실제로 관측한 Brave `page_age` 값들이다 (2026-09-06).
 */
describe('hasRecentSource', () => {
  const NOW = new Date('2026-09-06T00:00:00Z');
  const at = (iso: string) => ({ publishedAt: new Date(iso) });

  it('전부 최근이면 통과 — BepiColombo (2~4일 전)', () => {
    expect(hasRecentSource(
      [at('2026-09-03'), at('2026-09-04'), at('2026-09-02')], NOW,
    )).toBe(true);
  });

  it('오래된 것이 섞여 있어도 하나만 최근이면 통과', () => {
    // 배경이 되는 1차 논문은 원래 오래됐다. 그것 때문에 토픽을 버리면 안 된다
    expect(hasRecentSource(
      [at('2018-03-05'), at('2021-10-20'), at('2026-08-20')], NOW,
    )).toBe(true);
  });

  it('전부 오래되면 거른다 — sorbitol (최신이 약 2.5개월 전)', () => {
    expect(hasRecentSource(
      [at('2025-10-28'), at('2025-12-09'), at('2026-06-19'), at('2026-02-06')], NOW,
    )).toBe(false);
  });

  it('전부 오래되면 거른다 — magic angle graphene (2018~2025)', () => {
    expect(hasRecentSource(
      [at('2018-03-05'), at('2023-01-30'), at('2025-11-06')], NOW,
    )).toBe(false);
  });

  it('날짜를 아는 출처가 없으면 통과시킨다', () => {
    // 모르는 것을 배제 사유로 쓰지 않는다. Brave 커버리지는 97% 지만 0% 가 될 수도 있다
    expect(hasRecentSource([{ publishedAt: null }, { publishedAt: null }], NOW)).toBe(true);
  });

  it('빈 목록도 통과시킨다', () => {
    expect(hasRecentSource([], NOW)).toBe(true);
  });
});
