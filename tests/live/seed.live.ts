import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { createServiceClient } from '@/db/supabase/service';
import { runDailyDiscovery } from '@/pipeline/run-daily';

/**
 * 로컬 DB 를 실제 피드로 채운다. 지우지 않는다.
 * UI 작업 중 목록에 띄울 내용이 필요할 때 쓴다.
 *
 * 실행: pnpm seed
 */
describe('로컬 시드', () => {
  it('일간 런을 한 번 돌린다', async () => {
    const db = createServiceClient();
    const r = await runDailyDiscovery(db, getAnthropic());
    console.log('\n결과:', {
      후보: r.candidates,
      발행: r.published,
      실패피드: r.failures.length,
    });

    const { count } = await db
      .from('articles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published');
    console.log('발행된 기사 총계:', count, '\n');

    expect(r.failures).toEqual([]);
  }, 90_000);
});
