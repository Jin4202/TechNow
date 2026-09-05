import { mkdirSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { estimateCost, getAnthropic } from '@/clients/anthropic';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { listFixtures } from '@/pipeline/research/fixtures';
import { buildArticle } from '@/pipeline/write/build-article';
import { sentenceStats, wordCount } from '@/pipeline/write/write-article';

/** 사람이 읽을 수 있는 형태로 뽑는다 (3.17 준비). 실행: pnpm articles:export */
const claude = getAnthropic();

describe('기사 내보내기', () => {
  it('fixture 전체를 마크다운으로', async () => {
    const fixtures = listFixtures();
    const parts: string[] = [
      '# 생성된 기사 샘플',
      '',
      `생성 시각: ${new Date().toISOString()}`,
      '',
      '스타일 가이드 목표: 섹션 3~5개, 600~900단어, 평균 문장 24단어 미만, 40단어 초과 없음.',
      '',
      '---',
      '',
    ];
    const summary: string[] = ['| fixture | 단어 | 평균문장 | 최장 | 40초과 | 진술 | 시도 | 비용 |', '|---|---|---|---|---|---|---|---|'];
    const generated: { slug: string; topicTitle: string; article: unknown; attempts: number }[] = [];

    for (const fixture of fixtures) {
      const r = await buildArticle(claude, {
        topicTitle: fixture.topicTitle,
        sources: fixture.sources,
        tier1CandidatesSeen: fixture.sources.filter((s) => s.tier === 1).length,
      });
      const c = estimateCost(r.usage, PRICING[MODEL_SONNET], {
        cacheRead: CACHE_READ_MULTIPLIER,
        cacheWrite: CACHE_WRITE_MULTIPLIER,
      });

      if (!r.article) {
        parts.push(`## ✗ ${fixture.slug}`, '', `실패: ${r.failure} — ${r.detail ?? ''}`, '', '---', '');
        summary.push(`| ${fixture.slug} | — | — | — | — | — | ${r.attempts} | $${c.toFixed(3)} |`);
        continue;
      }

      const a = r.article;
      generated.push({ slug: fixture.slug, topicTitle: fixture.topicTitle, article: a, attempts: r.attempts });
      const stats = sentenceStats(a);
      summary.push(
        `| ${fixture.slug} | ${wordCount(a)} | ${stats.averageWords.toFixed(1)} | ${stats.longest} | ${stats.overLimit.length} | ${r.verification!.claims.length} | ${r.attempts} | $${c.toFixed(3)} |`,
      );

      parts.push(
        `## ${a.title}`,
        '',
        `*${a.oneLineSummary}*`,
        '',
        `\`${a.category}\` · ${a.tags.join(' · ')}`,
        '',
        `> ${wordCount(a)}단어 · 문장 ${stats.count}개 · 평균 ${stats.averageWords.toFixed(1)}단어 · 최장 ${stats.longest}단어 · 진술 ${r.verification!.claims.length}개 · 시도 ${r.attempts}회`,
        '',
      );

      for (const s of a.sections) {
        parts.push(`### ${s.heading}`, '');
        for (const p of s.paragraphs) parts.push(p, '');
        parts.push(`<small>출처 ${s.sources.join(', ')}</small>`, '');
      }

      parts.push('#### 출처', '');
      for (const src of fixture.sources) {
        parts.push(`${src.ordinal}. [Tier ${src.tier}] ${src.title ?? src.url}  `, `   ${src.url}`);
      }
      parts.push('', '---', '');
    }

    mkdirSync('out', { recursive: true });
    const path = 'out/sample-articles.md';
    writeFileSync(path, `${parts.join('\n')}\n## 요약\n\n${summary.join('\n')}\n`);

    // 평가는 이 JSON 을 읽는다. 매번 재생성하면 비용도 들고,
    // LLM 비결정성 때문에 같은 대상을 평가하는 것도 아니게 된다
    const jsonPath = process.env.ARTICLES_OUT ?? 'out/articles.json';
    writeFileSync(jsonPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), articles: generated }, null, 2)}\n`);

    console.log(`\n→ ${path}`);
    console.log(`→ ${jsonPath}`);
    console.log(summary.join('\n'));

    expect(true).toBe(true);
  }, 1_800_000);
});
