import { mkdirSync, writeFileSync } from 'node:fs';

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

import type { WrittenArticle } from '@/pipeline/write/write-article';

/**
 * fixture 전체로 기사를 만든다. 실행: pnpm build:live
 *
 * **만든 기사를 `out/articles.json` 에 남긴다** — `pnpm evaluate` 가 이 파일을 읽는다.
 * 예전에는 `pnpm articles:export` 가 같은 생성을 한 번 더 돌려서 실험 1회마다
 * 생성 비용이 두 번 나갔다 (fixture 14건 기준 약 $2.4). 통과율·비용과 품질 평가는
 * **같은 기사**를 봐야 하기도 한다 — 따로 돌리면 두 리포트가 다른 기사를 말한다.
 *
 * 출력 경로는 ARTICLES_OUT 으로 바꿀 수 있다. A/B 의 양쪽을 다른 파일로 받을 때 쓴다.
 *
 * **한 건 끝날 때마다 파일에 쓴다.** 마지막에 한 번만 쓰면 타임아웃 하나로 그때까지
 * 쓴 돈이 전부 날아간다 — 실제로 fixture 를 5 → 14 건으로 늘리고 타임아웃을 안 올려
 * 12건까지 간 런이 통째로 버려졌다 (2026-09-06, 약 $2). 재현 비용이 비싼 측정에서는
 * 중간 결과를 붙잡아 두는 쪽이 맞다.
 */

/** fixture 한 건에 넉넉히 잡은 시간. 5건 기준으로 굳어 있던 30분이 14건에서 터졌다 */
const MS_PER_FIXTURE = 240_000;
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
    const generated: {
      slug: string;
      topicTitle: string;
      article: WrittenArticle;
      attempts: number;
    }[] = [];

    const outPath = process.env.ARTICLES_OUT ?? 'out/articles.json';
    mkdirSync('out', { recursive: true });
    /** 중간 결과를 즉시 남긴다. 뒤에서 터져도 여기까지는 남는다 */
    const save = () =>
      writeFileSync(
        outPath,
        `${JSON.stringify({ generatedAt: new Date().toISOString(), articles: generated }, null, 2)}\n`,
      );

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
        generated.push({
          slug: fixture.slug,
          topicTitle: fixture.topicTitle,
          article: r.article,
          attempts: r.attempts,
        });
        const stats = sentenceStats(r.article);
        rows.push(
          `✓ ${fixture.slug.padEnd(22)} 시도${r.attempts} ${String(wordCount(r.article)).padStart(4)}단어 ` +
            `평균${stats.averageWords.toFixed(1)} 진술${r.verification!.claims.length} $${c.toFixed(4)} ${seconds}초`,
        );
        console.log(`\n━━ ${fixture.slug}`);
        console.log(`제목: ${r.article.title}`);
        console.log(`요약: ${r.article.oneLineSummary}`);
        console.log(`${r.article.category} | ${r.article.tags.join(', ')} | 섹션 ${r.article.sections.length}`);
        save();
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
      // 표는 마지막에 한 번 그리지만, 잘려도 읽히도록 진행 상황을 한 줄씩 남긴다
      console.log(`[${rows.length}/${fixtures.length}] ${rows[rows.length - 1]}`);
    }

    console.log('\n' + '═'.repeat(78));
    for (const row of rows) console.log(row);
    console.log('═'.repeat(78));
    console.log(`성공 ${succeeded}/${fixtures.length}, 재시도 ${retried}건`);
    console.log(`평균 비용 $${(totalCost / fixtures.length).toFixed(4)}/건 (변동비 목표 $${budget.variableUsdPerArticle})`);
    console.log(`성공 건만: $${(totalCost / Math.max(succeeded, 1)).toFixed(4)}/건`);

    console.log(`\n기사 ${generated.length}편 → ${outPath} (pnpm evaluate 가 읽는다)`);

    expect(succeeded, '전부 실패하면 파이프라인이 성립하지 않는다').toBeGreaterThan(0);
  }, listFixtures().length * MS_PER_FIXTURE);
});
