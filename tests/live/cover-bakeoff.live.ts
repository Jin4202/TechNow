import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { FalClient, IMAGE_MODELS, IMAGE_PRICING, type ImageModel } from '@/clients/fal';
import { buildCoverPrompt } from '@/prompts/cover-image';

import type { WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 커버 이미지 비교 (로드맵 5.1). 실행: pnpm covers:bakeoff
 *
 * 같은 프롬프트로 Flux schnell 과 Imagen 4 Fast 를 각각 5장씩 만든다.
 * 판단은 사람이 한다 — `out/covers.md` 를 열고 두 열을 나란히 본다.
 *
 * 비용: Flux 5장 $0.015 + Imagen 5장 $0.10 = 약 $0.12.
 * Imagen 이 7배 비싸다는 것이 이 비교의 핵심이다. **격차가 분명할 때만**
 * 비싼 쪽으로 간다 (기획서 §7).
 *
 * 기사는 `out/articles.json` 에서 가져온다. 새로 생성하지 않는다 —
 * 커버는 실제 기사 제목에 붙는 것이고, 지어낸 제목으로 비교하면
 * 우리 기사에서 어떻게 나오는지를 못 본다.
 */

interface StoredArticle {
  slug: string;
  article: WrittenArticle;
}

const HOW_MANY = 5;

async function download(url: string, path: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`이미지 내려받기 실패: HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(path, bytes);
  return bytes.length;
}

describe('커버 이미지 비교 (5.1)', () => {
  it(
    '같은 프롬프트로 두 모델을 각각 5장',
    async () => {
      const stored = JSON.parse(readFileSync('out/articles.json', 'utf8')) as {
        articles: StoredArticle[];
      };
      const targets = stored.articles.slice(0, HOW_MANY);
      expect(targets.length, 'out/articles.json 이 비어 있다').toBeGreaterThan(0);

      const fal = new FalClient();
      mkdirSync('out/covers', { recursive: true });

      const rows: string[] = [
        '# 커버 이미지 비교 (5.1)',
        '',
        `모델 2종 × 기사 ${targets.length}편. 같은 프롬프트다.`,
        '',
        '**보는 법**: 같은 줄의 두 이미지가 같은 프롬프트의 결과다. 볼 것은',
        '',
        '1. **한 줄로 놓았을 때 같은 사이트처럼 보이나.** 장당 품질보다 이게 중요하다',
        '2. **글자가 들어갔나.** 잘못 쓴 글자가 박힌 커버는 없느니만 못하다',
        '3. **사람·로고가 나왔나.** 나왔으면 프롬프트가 아니라 필터를 고쳐야 한다',
        '4. **기사와 관련이 있나.** 아무 추상 도형이나 나오면 커버의 값이 없다',
        '',
        `Imagen 은 장당 $${IMAGE_PRICING[IMAGE_MODELS.imagen4Fast]}, Flux 는 $${IMAGE_PRICING[IMAGE_MODELS.fluxSchnell]} 로 **7배** 차이다.`,
        '격차가 분명하지 않으면 Flux 다 (기획서 §7).',
        '',
        '| 기사 | Flux schnell | Imagen 4 Fast |',
        '|---|---|---|',
      ];

      let cost = 0;
      const failures: string[] = [];

      for (const entry of targets) {
        const prompt = buildCoverPrompt(entry.article.title, entry.article.oneLineSummary);
        const cells: string[] = [];

        for (const [name, model] of [
          ['flux', IMAGE_MODELS.fluxSchnell],
          ['imagen', IMAGE_MODELS.imagen4Fast],
        ] as [string, ImageModel][]) {
          try {
            const image = await fal.generate(model, prompt);
            const file = `covers/${entry.slug}-${name}.jpg`;
            const bytes = await download(image.url, `out/${file}`);
            cost += IMAGE_PRICING[model];

            cells.push(`<img src="${file}" width="320">`);
            console.log(`${entry.slug} ${name}: ${image.width}×${image.height} ${Math.round(bytes / 1024)}KB`);
          } catch (error) {
            // 한 모델이 실패해도 비교는 계속한다. 실패 자체가 비교 결과다
            const message = error instanceof Error ? error.message : String(error);
            failures.push(`${entry.slug} ${name}: ${message}`);
            cells.push(`실패 — ${message.slice(0, 80)}`);
            console.log(`${entry.slug} ${name}: 실패 ${message.slice(0, 100)}`);
          }
        }

        rows.push(`| **${entry.article.title}**<br><sub>${prompt.slice(-120)}</sub> | ${cells[0]} | ${cells[1]} |`);
      }

      rows.push('', `생성 비용 $${cost.toFixed(3)} · 실패 ${failures.length}건`);
      writeFileSync('out/covers.md', rows.join('\n'));

      console.log(`\nout/covers.md ($${cost.toFixed(3)})`);
      expect(failures, `실패: ${failures.join(' / ')}`).toHaveLength(0);
    },
    600_000,
  );
});
