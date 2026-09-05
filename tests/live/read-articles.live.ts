import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { findViolations, textMetrics } from '@/pipeline/write/quality-metrics';
import { compareToBand, loadReference } from '@/pipeline/write/reference-band';
import { articleText, type WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 사람이 읽을 기사 묶음 (로드맵 3.17). 실행: pnpm articles:read
 *
 * **아무것도 생성하지 않는다.** `out/articles.json` 을 읽어 본문과 지표를 한 문서로
 * 합칠 뿐이라 비용이 0 이고, 몇 번을 돌려도 같은 기사를 본다.
 *
 * 기사를 다시 만들면(`pnpm articles:export`) LLM 비결정성 때문에 읽은 것과
 * 평가한 것이 달라진다 — 그래서 생성과 읽기를 분리한다.
 */

interface StoredArticle {
  slug: string;
  topicTitle: string;
  article: WrittenArticle;
  attempts: number;
}

const ARROW: Record<string, string> = { below: '↓ 낮음', within: '· 대역 안', above: '↑ 높음' };

/** 읽기 전에 알고 있으면 좋은 것만. 전체 지표는 out/evaluation.md 에 있다 */
const HEADLINE_METRICS = [
  ['fleschReadingEase', '읽기 쉬움 (높을수록 쉽다)'],
  ['sentenceMean', '평균 문장 길이'],
  ['sentenceStdev', '문장 길이 편차 (섞여 있는가)'],
  ['sentenceMax', '최장 문장'],
  ['words', '단어 수'],
] as const;

describe('기사 읽기용 묶음', () => {
  it('본문과 지표를 한 문서로 합친다', () => {
    const stored = JSON.parse(readFileSync('out/articles.json', 'utf8')) as {
      generatedAt: string;
      articles: StoredArticle[];
    };
    const reference = loadReference();

    const parts: string[] = [
      '# 읽을 기사',
      '',
      `생성 ${stored.generatedAt} · 기사 ${stored.articles.length}편`,
      '',
      '읽으면서 봐줬으면 하는 것 (로드맵 3.17):',
      '',
      '1. **어디서 멈췄나.** 다시 읽어야 했던 문장이 있으면 그 문장을 알려줘.',
      '2. **전문용어가 처음 나올 때 풀렸나.** 안 풀렸으면 어느 단어인지.',
      '3. **숫자가 그려지나.** "166,700개 뉴런" 이 크다는 건지 작다는 건지 알 수 있나.',
      '4. **읽고 나서 남는 게 있나.** 무슨 일이 있었는지 한 줄로 말할 수 있나.',
      '',
      '지표는 참고용이다. **지표가 대역 안이어도 읽기 나쁠 수 있고 그 반대도 된다** —',
      '그걸 알아내는 게 이 리뷰의 목적이다 (D-30 의 세 번째 층).',
      '',
      '---',
      '',
    ];

    for (const [i, entry] of stored.articles.entries()) {
      const a = entry.article;
      const metrics = textMetrics(articleText(a));
      const comparisons = compareToBand(metrics, reference.band);
      const byName = new Map(comparisons.map((c) => [c.metric, c]));
      const violations = findViolations(articleText(a));

      parts.push(
        `## ${i + 1}. ${a.title}`,
        '',
        `*${a.oneLineSummary}*`,
        '',
        `\`${entry.slug}\` · ${a.category} · ${a.tags.join(', ')}`,
        '',
        '<details><summary>지표 (읽기 전에 보지 않아도 된다)</summary>',
        '',
        '| | 값 | 실제 매체 p25~p75 | |',
        '|---|---|---|---|',
      );

      for (const [key, label] of HEADLINE_METRICS) {
        const c = byName.get(key)!;
        parts.push(
          `| ${label} | ${c.value.toFixed(1)} | ${c.band.p25.toFixed(1)} ~ ${c.band.p75.toFixed(1)} | ${ARROW[c.verdict]} |`,
        );
      }

      const flagged: string[] = [];
      if (violations.bannedWords.length > 0) flagged.push(`금지어 ${violations.bannedWords.join(', ')}`);
      if (violations.exclamations > 0) flagged.push(`느낌표 ${violations.exclamations}개`);
      parts.push('', flagged.length > 0 ? `위반: ${flagged.join(' / ')}` : '위반 없음', '', '</details>', '');

      for (const section of a.sections) {
        parts.push(`### ${section.heading}`, '');
        for (const paragraph of section.paragraphs) parts.push(paragraph, '');
        parts.push(`<small>출처 ${section.sources.join(', ')}</small>`, '');
      }

      parts.push('---', '');
    }

    mkdirSync('out', { recursive: true });
    writeFileSync('out/read.md', parts.join('\n'), 'utf8');
    console.log(`\nout/read.md — 기사 ${stored.articles.length}편`);

    expect(stored.articles.length).toBeGreaterThan(0);
  });
});
