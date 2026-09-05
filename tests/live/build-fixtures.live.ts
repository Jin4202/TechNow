import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { BraveClient } from '@/clients/brave';
import { hasFixture, saveFixture } from '@/pipeline/research/fixtures';
import { createFetchContext } from '@/pipeline/research/fetch-page';
import { researchTopic } from '@/pipeline/research/research-topic';

/**
 * fixture 세트를 만든다 (로드맵 3.11).
 * 이미 있는 slug 는 건너뛴다 — 굳힌 fixture 를 덮으면 비교가 무의미해진다.
 *
 * 실행: pnpm fixtures:build
 */
const TOPICS = [
  {
    slug: 'roman-telescope-l2',
    title: 'Nancy Grace Roman Space Telescope reaches its L2 observation point',
    items: [{
      title: 'Roman Space Telescope begins three-month journey to L2',
      description: "NASA's Nancy Grace Roman Space Telescope is on its way to the Sun-Earth L2 Lagrange point, where it will survey the sky to study dark energy and exoplanets.",
    }],
  },
  {
    slug: 'fly-connectome',
    title: 'Second complete map of a fruit fly brain completed',
    items: [{
      title: 'Second complete map of a fruit fly brain completed',
      description: 'Researchers published a complete connectome of a male Drosophila brain, following the earlier female connectome.',
    }],
  },
  {
    slug: 'magic-angle-graphene',
    title: 'Magic-angle graphene shows evidence for unconventional superconductivity',
    items: [{
      title: 'Magic-angle graphene provides evidence for unconventional superconductivity',
      description: 'Measurements of twisted bilayer graphene point to a pairing mechanism that differs from conventional phonon-mediated superconductivity.',
    }],
  },
  {
    slug: 'hall-effect-no-field',
    title: 'Hall effect observed without a perpendicular magnetic field',
    items: [{
      title: 'Physicists discover unexpected Hall effect independent of magnetic field',
      description: 'A measurement shows a Hall voltage arising without the perpendicular magnetic field the textbook effect requires.',
    }],
  },
  {
    slug: 'lz-dark-matter',
    title: 'LUX-ZEPLIN detector records unexplained particle interactions',
    items: [{
      title: 'LUX-ZEPLIN dark matter detector records mysterious particle interactions',
      description: 'The LZ experiment reported events that do not match known backgrounds, prompting further analysis.',
    }],
  },
];

describe('fixture 세트 구축 (3.11)', () => {
  it('토픽마다 조사 결과를 굳힌다', async () => {
    const claude = getAnthropic();
    const brave = new BraveClient();
    const fetchContext = createFetchContext();

    for (const topic of TOPICS) {
      if (hasFixture(topic.slug)) {
        console.log(`· ${topic.slug} — 이미 있음, 건너뜀`);
        continue;
      }

      const r = await researchTopic(claude, brave, fetchContext, {
        title: topic.title,
        items: topic.items,
      });

      if (r.skipped) {
        console.log(`✗ ${topic.slug} — ${r.skipped} (출처 ${r.sources.length}건)`);
        continue;
      }

      const path = saveFixture({
        slug: topic.slug,
        topicTitle: topic.title,
        capturedAt: new Date().toISOString(),
        queries: r.queries,
        sources: r.sources.map((s, i) => ({
          ordinal: i + 1,
          url: s.url,
          title: s.title,
          publisher: s.publisher,
          tier: s.tier,
          text: s.text,
        })),
      });
      console.log(`✓ ${topic.slug} — 출처 ${r.sources.length}건 → ${path}`);
    }

    expect(true).toBe(true);
  }, 900_000);
});
