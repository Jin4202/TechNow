import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getAnthropic, estimateCost } from '@/clients/anthropic';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { translateArticle } from '@/pipeline/translate/translate-article';

import type { WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 번역 프롬프트 라이브 확인 (로드맵 4.3). 실행: pnpm translate:live
 *
 * `out/articles.json` 의 기사를 그대로 번역한다 — 새로 생성하지 않는다.
 * 읽은 기사와 번역된 기사가 같아야 원문·번역을 나란히 비교할 수 있다.
 *
 * 산출: out/translation.md. 판단은 사람이 한다 (D-30 의 세 번째 층).
 * 한국어에는 Flesch 계열 지표가 성립하지 않으므로(음절 기반) 자동 채점을 두지 않는다.
 */

interface StoredArticle {
  slug: string;
  topicTitle: string;
  article: WrittenArticle;
}

/** 몇 편을 번역할지. 기사당 약 $0.03 */
const HOW_MANY = Number(process.env.TRANSLATE_COUNT ?? 1);

describe('번역 라이브', () => {
  it(
    '실제 기사를 한국어로 옮긴다',
    async () => {
      const stored = JSON.parse(readFileSync('out/articles.json', 'utf8')) as {
        articles: StoredArticle[];
      };
      const targets = stored.articles.slice(0, HOW_MANY);
      expect(targets.length, 'out/articles.json 이 비어 있다').toBeGreaterThan(0);

      const claude = getAnthropic();
      const parts: string[] = ['# 번역 확인', ''];
      let cost = 0;

      for (const entry of targets) {
        const result = await translateArticle(claude, {
          title: entry.article.title,
          oneLineSummary: entry.article.oneLineSummary,
          sections: entry.article.sections,
        });

        cost += estimateCost(result.usage, PRICING[MODEL_SONNET], {
          cacheRead: CACHE_READ_MULTIPLIER,
          cacheWrite: CACHE_WRITE_MULTIPLIER,
        });

        console.log(
          `${entry.slug}: ${result.failure ?? '성공'}${result.detail ? ` — ${result.detail}` : ''}`,
        );

        // 구조 검증(4.3a)까지 통과해야 번역본이 나온다
        expect(result.failure, `${entry.slug} 번역 실패`).toBeNull();
        const translation = result.translation!;

        parts.push(`## ${entry.slug}`, '');
        parts.push(`**원문** ${entry.article.title}`, '');
        parts.push(`**번역** ${translation.title}`, '');
        parts.push(`> ${entry.article.oneLineSummary}`, '');
        parts.push(`> ${translation.oneLineSummary}`, '');

        for (const [index, section] of translation.sections.entries()) {
          const source = entry.article.sections[index]!;
          parts.push(`### ${section.heading}`, `<small>${source.heading}</small>`, '');

          for (const [i, paragraph] of section.paragraphs.entries()) {
            parts.push(paragraph, '', `<small>${source.paragraphs[i]}</small>`, '');
          }

          parts.push(`<small>출처 ${section.sources.join(', ')}</small>`, '');
        }

        parts.push('---', '');
      }

      parts.push(`번역 ${targets.length}편 · 비용 $${cost.toFixed(3)}`);

      mkdirSync('out', { recursive: true });
      writeFileSync('out/translation.md', parts.join('\n'));
      console.log(`\nout/translation.md (${targets.length}편, $${cost.toFixed(3)})`);
    },
    300_000,
  );
});
