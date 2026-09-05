import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { AXIS_LABELS, judgeArticle, overallScore } from '@/pipeline/write/judge-article';
import { findViolations, textMetrics } from '@/pipeline/write/quality-metrics';
import { compareToBand, loadReference } from '@/pipeline/write/reference-band';
import { articleText, type WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 기사 평가 리포트 (평가 프레임워크). 실행: pnpm evaluate
 *
 * 계산 지표를 기준 대역과 대보고, 루브릭 판정을 붙인다.
 *
 * **합격/불합격을 찍지 않는다.** 대역 안/밖과 근거만 보여주고 판단은 사람이 한다.
 * 대역 밖이라는 것은 "실제 매체와 다르다" 는 뜻이지 "나쁘다" 가 아니다.
 */
const claude = getAnthropic();

interface StoredArticle {
  slug: string;
  topicTitle: string;
  article: WrittenArticle;
  attempts: number;
}

const ARROW: Record<string, string> = { below: '↓', within: '·', above: '↑' };

describe('기사 평가', () => {
  it('지표와 루브릭으로 평가하고 리포트를 만든다', async () => {
    const inputPath = process.env.ARTICLES_IN ?? 'out/articles.json';
    const stored = JSON.parse(readFileSync(inputPath, 'utf8')) as {
      generatedAt: string;
      articles: StoredArticle[];
    };
    const reference = loadReference();

    const parts: string[] = [
      '# 기사 평가',
      '',
      `기사 생성: ${stored.generatedAt}`,
      `기준 코퍼스: ${reference.articles}편 (${Object.entries(reference.sampleCounts).map(([k, v]) => `${k} ${v}`).join(', ')}), ${reference.builtAt}`,
      '',
      '기준 대역은 실제 일반 독자용 과학 매체를 같은 함수로 재서 만든 p25~p75 구간이다.',
      '`↓`/`↑` 는 그 구간을 벗어났다는 뜻이며, **좋고 나쁨의 판정이 아니다.**',
      '',
      '---',
      '',
    ];

    const scoreRows = ['| fixture | 종합 | 이해 | 용어 | 구체 | 구조 | 어조 | stall |', '|---|---|---|---|---|---|---|---|'];

    for (const entry of stored.articles) {
      const article = entry.article;
      const text = articleText(article);
      const metrics = textMetrics(text);
      const comparisons = compareToBand(metrics, reference.band);
      const violations = findViolations(text);
      const { judgement, error, usage } = await judgeArticle(claude, article);

      parts.push(`## ${entry.slug}`, '', `**${article.title}**`, '', `*${article.oneLineSummary}*`, '');

      // ── 계산 지표 ──
      parts.push('### 지표', '', '| 지표 | 값 | 기준 p25~p75 | |', '|---|---|---|---|');
      for (const c of comparisons) {
        const fmt = (n: number) => (Math.abs(n) < 1 ? n.toFixed(3) : n.toFixed(1));
        parts.push(
          `| ${c.metric} | ${fmt(c.value)} | ${fmt(c.band.p25)} ~ ${fmt(c.band.p75)} | ${ARROW[c.verdict]} |`,
        );
      }
      parts.push('');

      const outside = comparisons.filter((c) => c.verdict !== 'within');
      if (outside.length > 0) {
        parts.push(
          `대역 밖: ${outside.map((c) => `${c.metric} ${ARROW[c.verdict]}`).join(', ')}`,
          '',
        );
      }

      if (violations.bannedWords.length || violations.exclamations || violations.rhetoricalQuestions.length) {
        parts.push('### 위반', '');
        if (violations.bannedWords.length) parts.push(`- 금지어: ${violations.bannedWords.join(', ')}`);
        if (violations.exclamations) parts.push(`- 느낌표 ${violations.exclamations}개`);
        for (const q of violations.rhetoricalQuestions) parts.push(`- 의문문: "${q}"`);
        parts.push('');
      }

      // ── 루브릭 ──
      if (!judgement) {
        parts.push(`### 루브릭`, '', `판정 실패: ${error}`, '');
        scoreRows.push(`| ${entry.slug} | — | — | — | — | — | — | — |`);
      } else {
        const axes = [
          ['comprehensibility', judgement.comprehensibility],
          ['termHandling', judgement.termHandling],
          ['concreteness', judgement.concreteness],
          ['structure', judgement.structure],
          ['tone', judgement.tone],
        ] as const;

        parts.push('### 루브릭', '');
        for (const [key, axis] of axes) {
          parts.push(`**${AXIS_LABELS[key]} ${axis.score}/5** — ${axis.note}`, '');
          for (const e of axis.evidence) parts.push(`> ${e}`, '');
        }

        if (judgement.stallPoints.length > 0) {
          parts.push('### 걸리는 문장', '');
          for (const s of judgement.stallPoints) {
            parts.push(`- "${s.sentence}"`, `  → ${s.why}`, '');
          }
        } else {
          parts.push('### 걸리는 문장', '', '없음', '');
        }

        scoreRows.push(
          `| ${entry.slug} | ${overallScore(judgement).toFixed(1)} | ${judgement.comprehensibility.score} | ${judgement.termHandling.score} | ${judgement.concreteness.score} | ${judgement.structure.score} | ${judgement.tone.score} | ${judgement.stallPoints.length} |`,
        );

        console.log(
          `${entry.slug.padEnd(24)} 종합 ${overallScore(judgement).toFixed(1)} ` +
            `이해${judgement.comprehensibility.score} 용어${judgement.termHandling.score} ` +
            `구체${judgement.concreteness.score} 구조${judgement.structure.score} 어조${judgement.tone.score} ` +
            `stall ${judgement.stallPoints.length} | ` +
            `문장평균 ${metrics.sentenceMean.toFixed(1)} 편차 ${metrics.sentenceStdev.toFixed(1)} ` +
            `FRE ${metrics.fleschReadingEase.toFixed(0)} 단어 ${metrics.words} | ` +
            `대역밖 ${outside.length}`,
        );
      }

      void usage;
      parts.push('---', '');
    }

    parts.push('## 루브릭 요약', '', ...scoreRows, '');

    mkdirSync('out', { recursive: true });
    const outPath = process.env.EVAL_OUT ?? 'out/evaluation.md';
    writeFileSync(outPath, `${parts.join('\n')}\n`);
    console.log(`\n→ ${outPath}`);
    console.log('\n기준 대역 (실제 과학 매체 p25~p75):');
    for (const [key, b] of Object.entries(reference.band)) {
      console.log(`  ${key.padEnd(20)} ${b.p25.toFixed(2).padStart(9)} ~ ${b.p75.toFixed(2).padStart(9)}  (중앙 ${b.p50.toFixed(2)})`);
    }

    expect(stored.articles.length).toBeGreaterThan(0);
  }, 900_000);
});
