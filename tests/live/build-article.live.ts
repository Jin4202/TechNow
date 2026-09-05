import { describe, expect, it } from 'vitest';

import { estimateCost, getAnthropic } from '@/clients/anthropic';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { budget } from '@/config/budget';
import { listFixtures } from '@/pipeline/research/fixtures';
import { buildArticle } from '@/pipeline/write/build-article';
import { sentenceStats, wordCount } from '@/pipeline/write/write-article';

// fixture 전체로 기사를 만든다. 실행: pnpm build:live
const claude = getAnthropic();
const cost = (u: Parameters<typeof estimateCost>[0]) =>
  estimateCost(u, PRICING[MODEL_SONNET], {
    cacheRead: CACHE_READ_MULTIPLIER,
    cacheWrite: CACHE_WRITE_MULTIPLIER,
  });

describe('기사 생성 전체 (3.9, 3.10)', () => {
  it('fixture 전체로 만들어 통과율과 비용을 본다', async () => {
    const fixtures = listFixtures();
    const rows: string[] = [];
    let totalCost = 0;
    let succeeded = 0;
    let retried = 0;

    for (const fixture of fixtures) {
      const started = Date.now();
      const r = await buildArticle(claude, {
        topicTitle: fixture.topicTitle,
        sources: fixture.sources,
        // fixture 는 조사에 성공한 것들이라 Tier 1 후보가 있었다고 본다
        tier1CandidatesSeen: fixture.sources.filter((s) => s.tier === 1).length,
      });
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      const c = cost(r.usage);
      totalCost += c;
      if (r.attempts > 1) retried += 1;

      if (r.article) {
        succeeded += 1;
        const stats = sentenceStats(r.article);
        rows.push(
          `✓ ${fixture.slug.padEnd(22)} 시도${r.attempts} ${String(wordCount(r.article)).padStart(4)}단어 ` +
            `평균${stats.averageWords.toFixed(1)} 진술${r.verification!.claims.length} $${c.toFixed(4)} ${seconds}초`,
        );
        console.log(`\n━━ ${fixture.slug}`);
        console.log(`제목: ${r.article.title}`);
        console.log(`요약: ${r.article.oneLineSummary}`);
        console.log(`${r.article.category} | ${r.article.tags.join(', ')} | 섹션 ${r.article.sections.length}`);
      } else {
        rows.push(
          `✗ ${fixture.slug.padEnd(22)} 시도${r.attempts} ${r.failure} — ${(r.detail ?? '').slice(0, 40)} $${c.toFixed(4)}`,
        );
        console.log(`\n━━ ${fixture.slug} 실패: ${r.failure}`);
        for (const u of r.verification?.unsupported.slice(0, 4) ?? []) {
          console.log(`   ✗ "${u.claim.text.slice(0, 74)}"`);
          console.log(`     → ${u.note.slice(0, 88)}`);
        }
      }
    }

    console.log('\n' + '═'.repeat(78));
    for (const row of rows) console.log(row);
    console.log('═'.repeat(78));
    console.log(`성공 ${succeeded}/${fixtures.length}, 재시도 ${retried}건`);
    console.log(`평균 비용 $${(totalCost / fixtures.length).toFixed(4)}/건 (변동비 목표 $${budget.variableUsdPerArticle})`);
    console.log(`성공 건만: $${(totalCost / Math.max(succeeded, 1)).toFixed(4)}/건`);

    expect(succeeded, '전부 실패하면 파이프라인이 성립하지 않는다').toBeGreaterThan(0);
  }, 1_800_000);
});
