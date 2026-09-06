import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { getAnthropic, estimateCost } from '@/clients/anthropic';
import { FalClient, IMAGE_MODELS, IMAGE_PRICING, type ImageModel } from '@/clients/fal';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { chooseCoverConcept } from '@/pipeline/illustrate/choose-concept';
import { buildCoverPrompt } from '@/prompts/cover-image';

import type { WrittenArticle } from '@/pipeline/write/write-article';

/**
 * 커버 이미지 비교 (로드맵 5.1). 실행: pnpm covers:bakeoff
 *
 * 같은 프롬프트로 후보 모델들을 각각 5장씩 만든다 (`BAKEOFF_MODELS`).
 * 판단은 사람이 한다 — `out/covers.md` 를 열고 두 열을 나란히 본다.
 *
 * 비용: Flux 는 5장에 $0.015. 비싼 모델을 붙이면 그만큼 는다.
 * **격차가 분명할 때만** 비싼 쪽으로 간다 (기획서 §7).
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

/**
 * 비교할 모델. 기본은 Flux 하나다.
 *
 * 기획서 §7 이 지목한 Imagen 4 Fast 는 이 계정에서 부를 수 없다 (404).
 * 대안을 붙일 때는 `BAKEOFF_MODELS=fal-ai/flux/schnell,fal-ai/recraft-v3` 처럼 넘긴다 —
 * 어느 모델을 살지는 사람이 정하는 것이고, 스크립트가 정할 일이 아니다.
 */
const MODELS: ImageModel[] = (process.env.BAKEOFF_MODELS ?? IMAGE_MODELS.fluxSchnell)
  .split(',')
  .map((m) => m.trim() as ImageModel)
  .filter(Boolean);

function shortName(model: ImageModel): string {
  return model.split('/').slice(1).join('-');
}

async function download(url: string, path: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`이미지 내려받기 실패: HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(path, bytes);
  return bytes.length;
}

describe('커버 이미지 비교 (5.1)', () => {
  it(
    '같은 프롬프트로 후보 모델을 각각 5장',
    async () => {
      const stored = JSON.parse(readFileSync('out/articles.json', 'utf8')) as {
        articles: StoredArticle[];
      };
      const targets = stored.articles.slice(0, HOW_MANY);
      expect(targets.length, 'out/articles.json 이 비어 있다').toBeGreaterThan(0);

      const fal = new FalClient();
      const claude = getAnthropic();
      mkdirSync('out/covers', { recursive: true });

      const rows: string[] = [
        '# 커버 이미지 비교 (5.1)',
        '',
        `모델 2종 × 기사 ${targets.length}편. 같은 프롬프트다.`,
        '',
        '**보는 법**: 볼 것은',
        '',
        '1. **한 줄로 놓았을 때 같은 사이트처럼 보이나.** 장당 품질보다 이게 중요하다',
        '2. **글자가 들어갔나.** 잘못 쓴 글자가 박힌 커버는 없느니만 못하다',
        '3. **얼굴이 나왔나.** 실루엣·뒷모습은 괜찮고 얼굴은 안 된다 (D-38)',
        '4. **기사와 관련이 있나.** 아무 추상 도형이나 나오면 커버의 값이 없다',
        '',
        '`mode` 는 Claude 가 고른 그림의 유형이다 — subject(사물) / scene(비유) / future(영향력).',
        '',
        MODELS.map((m) => `\`${m}\` 장당 $${IMAGE_PRICING[m] ?? '?'}`).join(' · '),
        '',
        '격차가 분명하지 않으면 싼 쪽이다 (기획서 §7).',
        '',
        `| 기사 | ${MODELS.map(shortName).join(' | ')} |`,
        `|---|${MODELS.map(() => '---').join('|')}|`,
      ];

      let cost = 0;
      const failures: string[] = [];

      for (const entry of targets) {
        // 무엇을 그릴지 먼저 정한다 (D-38). 이미지 모델은 기사를 읽지 않았다
        const chosen = await chooseCoverConcept(claude, entry.article);
        cost += estimateCost(chosen.usage, PRICING[MODEL_SONNET], {
          cacheRead: CACHE_READ_MULTIPLIER,
          cacheWrite: CACHE_WRITE_MULTIPLIER,
        });

        if (!chosen.concept) {
          failures.push(`${entry.slug} concept: ${chosen.failure} ${chosen.detail ?? ''}`);
          rows.push(`| **${entry.article.title}** | 장면 선택 실패 — ${chosen.failure} |`);
          continue;
        }

        const { mode, scene, rationale } = chosen.concept;
        console.log(`\n${entry.slug} [${mode}] ${scene}`);

        const prompt = buildCoverPrompt(scene);
        const cells: string[] = [];

        for (const model of MODELS) {
          const name = shortName(model);
          try {
            const image = await fal.generate(model, prompt);
            const file = `covers/${entry.slug}-${name}.jpg`;
            const bytes = await download(image.url, `out/${file}`);
            cost += IMAGE_PRICING[model] ?? 0;

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

        rows.push(
          `| **${entry.article.title}**<br>` +
            `<sub>**[${mode}]** ${scene}</sub><br>` +
            `<sub>왜: ${rationale}</sub> | ${cells.join(' | ')} |`,
        );
      }

      rows.push('', `생성 비용 $${cost.toFixed(3)} · 실패 ${failures.length}건`);
      writeFileSync('out/covers.md', rows.join('\n'));

      console.log(`\nout/covers.md ($${cost.toFixed(3)})`);
      expect(failures, `실패: ${failures.join(' / ')}`).toHaveLength(0);
    },
    600_000,
  );
});
