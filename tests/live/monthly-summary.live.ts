import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { estimateCost, getAnthropic } from '@/clients/anthropic';
import { LOCALES } from '@/config/locales';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { summarizeMonth, type SummaryArticle } from '@/pipeline/summarize/monthly-summary';

import type { WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 월간 요약 라이브 확인 (로드맵 6.4). 실행: pnpm summary:live
 *
 * 완료 기준이 "기사 5개로 두 언어의 테스트 요약" 이다. `out/articles.json` 의
 * 기사를 스크랩한 셈 치고 두 언어로 만들어 `out/monthly-summary.md` 에 낸다.
 *
 * 비용: 언어당 약 $0.01.
 */

interface StoredArticle {
  slug: string;
  article: WrittenArticle;
}

describe('월간 요약 라이브 (6.4)', () => {
  it(
    '같은 스크랩으로 영어와 한국어 요약을 만든다',
    async () => {
      const stored = JSON.parse(readFileSync('out/articles.json', 'utf8')) as {
        articles: StoredArticle[];
      };

      const articles: SummaryArticle[] = stored.articles.map((entry) => ({
        articleId: entry.slug,
        slug: entry.slug,
        category: entry.article.category,
        title: entry.article.title,
        oneLineSummary: entry.article.oneLineSummary,
      }));

      expect(articles.length, 'out/articles.json 이 비어 있다').toBeGreaterThan(0);

      const parts: string[] = [
        '# 월간 요약 확인 (6.4)',
        '',
        `스크랩 ${articles.length}건을 두 언어로 요약했다. 같은 입력이다.`,
        '',
        '**볼 것**: 카테고리 묶음이 말이 되는가, 기사마다 두세 문장인가,',
        '한국어가 영어를 그대로 옮긴 티가 나지 않는가, 없는 내용을 지어내지 않았는가.',
        '',
      ];

      let cost = 0;

      for (const locale of LOCALES) {
        const result = await summarizeMonth(getAnthropic(), articles, locale);

        cost += estimateCost(result.usage, PRICING[MODEL_SONNET], {
          cacheRead: CACHE_READ_MULTIPLIER,
          cacheWrite: CACHE_WRITE_MULTIPLIER,
        });

        console.log(`${locale}: ${result.failure ?? '성공'} (${result.articleIds.length}건)`);

        expect(result.failure, `${locale} 요약 실패: ${result.detail ?? ''}`).toBeNull();
        // 담아둔 기사가 하나도 빠지지 않아야 한다
        expect(result.articleIds).toHaveLength(articles.length);

        parts.push(`---`, '', `## ${locale}`, '', result.markdown!, '');
      }

      parts.push('---', '', `비용 $${cost.toFixed(3)}`);

      mkdirSync('out', { recursive: true });
      writeFileSync('out/monthly-summary.md', parts.join('\n'));
      console.log(`\nout/monthly-summary.md ($${cost.toFixed(3)})`);
    },
    300_000,
  );
});
