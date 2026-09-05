import { mkdirSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { rejectReason } from '@/pipeline/discover/cheap-filters';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { createFetchContext, fetchPage } from '@/pipeline/research/fetch-page';
import { textMetrics, type TextMetrics } from '@/pipeline/write/quality-metrics';
import { computeBand, REFERENCE_PATH, type ReferenceCorpus } from '@/pipeline/write/reference-band';

import type { Feed } from '@/config/feeds';

/**
 * 기준 코퍼스 수집 (평가 프레임워크). 실행: pnpm reference:build
 *
 * 일반 독자용 과학 매체를 실제로 재서 "우리 기사가 어느 대역에 있어야 하는지"를 만든다.
 *
 * 원문은 저장하지 않는다 — 계산된 지표만 커밋한다. 제3자 기사 전문을 저장소에
 * 재배포하지 않으면서 대역은 버전 관리된다.
 */

/** 우리가 목표로 하는 독자층과 가장 가까운 매체들. 전부 tier2Domains 에 있다 */
const REFERENCE_FEEDS: Feed[] = [
  { name: 'ars-technica', url: 'https://feeds.arstechnica.com/arstechnica/index', covers: ['ai-computing'], approxItems: 20 },
  { name: 'ieee-spectrum', url: 'https://spectrum.ieee.org/feeds/feed.rss', covers: ['robotics-hardware'], approxItems: 30 },
  { name: 'quanta', url: 'https://www.quantamagazine.org/feed/', covers: ['physics-materials'], approxItems: 5 },
  { name: 'scientific-american', url: 'https://www.scientificamerican.com/platform/syndication/rss/', covers: ['health-biotech'], approxItems: 50 },
  { name: 'science-news', url: 'https://www.sciencenews.org/feed', covers: ['space-astronomy'], approxItems: 20 },
];

/** 매체당 최대 편수. 한 매체에 쏠리면 그 매체의 문체가 기준이 된다 */
const PER_OUTLET = 3;

/** 이보다 짧으면 기사가 아니라 공지나 요약이다 */
const MIN_WORDS = 250;

/**
 * 이보다 길면 일반 기사가 아니다.
 *
 * 실측에서 Quanta 의 11,194단어짜리 라이브 블로그가 섞여 들어왔다.
 * 한 편이 대역을 통째로 끌어당긴다
 */
const MAX_WORDS = 4000;

describe('기준 코퍼스 수집', () => {
  it('실제 과학 매체를 재서 대역을 만든다', async () => {
    const { items, failures } = await fetchFeeds(REFERENCE_FEEDS);
    for (const f of failures) console.log(`피드 실패: ${f.feedName} — ${f.reason}`);

    const unique = dedupeItems(items);
    const context = createFetchContext();

    const samples: TextMetrics[] = [];
    const sampleCounts: Record<string, number> = {};
    const skipped: Record<string, number> = {};

    for (const feed of REFERENCE_FEEDS) {
      const candidates = unique.filter((i) => i.feedName === feed.name);
      let taken = 0;

      for (const item of candidates) {
        if (taken >= PER_OUTLET) break;

        // 우리 저비용 필터가 거르는 글은 기준에서도 뺀다.
        // 발행하지 않을 글을 기준으로 삼으면 비교가 성립하지 않는다 —
        // 실측에서 IEEE 의 회원 소식(FRE 6)이 섞여 들어왔다
        const filtered = rejectReason(item);
        if (filtered) {
          skipped[`filter:${filtered}`] = (skipped[`filter:${filtered}`] ?? 0) + 1;
          continue;
        }

        const page = await fetchPage(context, item.url);
        if (!page.ok) {
          skipped[page.reason] = (skipped[page.reason] ?? 0) + 1;
          continue;
        }
        if (page.sponsored) {
          skipped.sponsored = (skipped.sponsored ?? 0) + 1;
          continue;
        }

        const metrics = textMetrics(page.text);
        if (metrics.words < MIN_WORDS) {
          skipped['too-short'] = (skipped['too-short'] ?? 0) + 1;
          continue;
        }
        if (metrics.words > MAX_WORDS) {
          skipped['too-long'] = (skipped['too-long'] ?? 0) + 1;
          continue;
        }

        samples.push(metrics);
        sampleCounts[feed.name] = (sampleCounts[feed.name] ?? 0) + 1;
        taken += 1;

        console.log(
          `✓ ${feed.name.padEnd(20)} ${String(metrics.words).padStart(5)}단어 ` +
            `문장평균 ${metrics.sentenceMean.toFixed(1)} ` +
            `FRE ${metrics.fleschReadingEase.toFixed(0)} ` +
            `${item.title.slice(0, 44)}`,
        );
      }
    }

    console.log(`\n수집 ${samples.length}편`, sampleCounts);
    console.log('건너뜀:', skipped);

    const corpus: ReferenceCorpus = {
      builtAt: new Date().toISOString(),
      sampleCounts,
      articles: samples.length,
      band: computeBand(samples),
    };

    mkdirSync('fixtures/reference', { recursive: true });
    writeFileSync(REFERENCE_PATH, `${JSON.stringify(corpus, null, 2)}\n`);

    console.log(`\n→ ${REFERENCE_PATH}\n`);
    console.log('지표            p25      p50      p75');
    console.log('─'.repeat(46));
    for (const [key, b] of Object.entries(corpus.band)) {
      console.log(
        `${key.padEnd(20)}${b.p25.toFixed(2).padStart(8)}${b.p50.toFixed(2).padStart(9)}${b.p75.toFixed(2).padStart(9)}`,
      );
    }

    // 12편 이상 모여야 대역이 의미가 있다
    expect(samples.length, '표본이 너무 적으면 대역이 흔들린다').toBeGreaterThanOrEqual(10);

    // 대역이 상식적인지 — 여기서 걸리면 추출이나 계산이 잘못된 것이다
    expect(corpus.band.sentenceMean.p50, '실제 기사 문장이 10단어일 리 없다').toBeGreaterThan(12);
    expect(corpus.band.sentenceMean.p50, '실제 기사 문장이 45단어일 리 없다').toBeLessThan(45);
    expect(corpus.band.words.p50, '기사 분량').toBeGreaterThan(300);
  }, 900_000);
});
