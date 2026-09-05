import { describe, expect, it } from 'vitest';

import { BraveClient } from '@/clients/brave';
import { filterSources } from '@/pipeline/research/source-tier';

// 실제 Brave API 호출. 실행: pnpm brave:live

describe('Brave Search (3.2, 3.2a)', () => {
  it('실제 검색이 되고 응답이 스키마와 맞는다', async () => {
    const client = new BraveClient();
    const results = await client.search('Roman Space Telescope L2 arrival NASA', 10);

    console.log(`\n결과 ${results.length}건:`);
    for (const r of results.slice(0, 8)) {
      console.log(`  ${r.url.slice(0, 88)}`);
    }

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.url.startsWith('http'))).toBe(true);
  }, 60_000);

  it('tier 필터를 실제 검색 결과에 적용한다 (3.3)', async () => {
    const client = new BraveClient();
    const results = await client.search(
      'fruit fly brain connectome complete map published',
      15,
    );
    const { accepted, rejected } = filterSources(results.map((r) => r.url));

    console.log(`\n검색 ${results.length}건 → 채택 ${accepted.length}, 제외 ${rejected.length}`);
    console.log('채택:');
    for (const s of accepted) console.log(`  T${s.tier} [${s.matched}] ${s.url.slice(0, 76)}`);
    const byReason: Record<string, number> = {};
    for (const r of rejected) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
    console.log('제외 사유:', byReason);

    // 실제 검색에서 쓸 만한 출처가 나오는지가 3.5 의 전제다
    expect(accepted.length, '채택된 출처가 없으면 조사 단계가 성립하지 않는다').toBeGreaterThan(0);
  }, 60_000);

  it('레이트 리밋 헤더를 확인한다 (3.2a)', async () => {
    // 헤더는 클라이언트가 감추므로 여기서만 직접 호출한다
    const response = await fetch(
      'https://api.search.brave.com/res/v1/web/search?q=test&count=1',
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': process.env.BRAVE_API_KEY!,
        },
      },
    );

    console.log(`\nHTTP ${response.status}`);
    for (const [key, value] of response.headers.entries()) {
      if (/rate|limit|quota|plan/i.test(key)) console.log(`  ${key}: ${value}`);
    }
    expect(response.ok).toBe(true);
  }, 60_000);
});
