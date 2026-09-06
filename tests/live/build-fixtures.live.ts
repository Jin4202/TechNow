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
 *
 * **5 → 12건으로 늘렸다** (2026-09-06, D-47). 5건으로는 통과율 60% 와 80% 를
 * 구분할 검정력이 없어서 재작성 A/B 가 "3/5 vs 3/5" 로 결론이 나지 않았다.
 *
 * 그리고 **카테고리 7종(D-15)을 전부 덮도록** 골랐다. 처음 5건은
 * physics-materials 3 · space-astronomy 1 · health-biotech 1 로 쏠려 있어서
 * 프롬프트를 고쳤을 때 특정 분야에서만 나아진 것을 전체 개선으로 오독할 수 있었다.
 *
 * 토픽은 **실제 피드 항목에서 골랐다.** 지어낸 주제는 검색이 빈손으로 돌아와
 * fixture 가 안 만들어지고, 만들어져도 실제 파이프라인의 입력과 다르다.
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
  {
    // ── 아래 7건은 카테고리 커버를 위해 추가 (D-47) ──────────────
    // ai-computing
    slug: 'alphafold-conformations',
    title: 'AlphaFold3 modified to predict multiple protein shapes',
    items: [{
      title: "Breaking through AlphaFold's limits to predict how proteins change shape",
      description: 'Conformational changes in proteins are vital to their function yet remain challenging for state-of-the-art artificial intelligence, such as AlphaFold3, to predict. Researchers at the Institute for Molecular Science introduced a repulsive force between predicted structures, allowing AlphaFold3 to sample multiple conformational states.',
    }],
  },
  {
    // ai-computing
    slug: 'fusion-plasma-ai',
    title: 'AI system controls fusion plasma faster than a human operator',
    items: [{
      title: 'AI can now control fusion plasma faster than humans can react',
      description: 'Princeton researchers have tested an AI system that can monitor and control fusion plasma in milliseconds, reacting far faster than a human operator. In one experiment, it predicted a damaging instability about 200 milliseconds before it appeared and adjusted the plasma to stop it from forming.',
    }],
  },
  {
    // climate-energy. 1차 시도는 출처 2건으로 실패했고 2차에서 4건으로 통과했다 —
    // 검색 결과가 실행마다 흔들린다는 뜻이다
    slug: 'indonesia-peat-fires',
    title: 'Indonesian peat fires surge early in the 2026 season',
    items: [{
      title: "Indonesia's most dangerous fires are burning underground",
      description: "Indonesia's peat fires are surging early in the 2026 fire season as a strengthening El Nino and severe drought dry out wetlands that can burn underground for months. These slow smoldering fires release far more fine particles than typical tropical forest fires, while thick smoke can make them difficult for satellites to detect.",
    }],
  },
  {
    // robotics-hardware
    slug: 'knitted-smart-fabric',
    title: 'Knitted textiles engineered to snap between stable shapes',
    items: [{
      title: 'Harvard scientists turn knitting into shape-shifting smart fabric',
      description: 'Harvard researchers have transformed knitting into a platform for fabrics that snap between different shapes. Using elastic yarns and industrial knitting techniques, the team engineered thick textiles that curve and lock into multiple stable configurations, much like a light switch flipping between on and off. Conductive yarn adds sensing.',
    }],
  },
  {
    // industry-policy — **두 번 다 실패했다** (출처 1건). 지우지 않고 남긴다:
    // 분석·논평 기사는 1차 보도가 없어 3건을 못 채운다는 관측이고,
    // industry-policy 가 공급이 얇은 카테고리라는 D-46 의 분석과 맞물린다.
    // hasFixture 가 막지 않으므로 조사 단계가 나아지면 다음 실행에서 통과한다.
    slug: 'eu-chip-strategy',
    title: "The E.U.'s AI build-out outpaces its own semiconductor capacity",
    items: [{
      title: "The E.U.'s AI Drive Undermines Its Own Chip Strategy",
      description: 'As the European Union rolls out AI factories, gigafactories, and new data centers, it is creating a surge in demand for the advanced semiconductors that underpin artificial intelligence. Yet Europe produces fewer than 10 percent of the world\'s chips, a contradiction at the centre of its technological sovereignty push.',
    }],
  },
  {
    // space-astronomy
    slug: 'bepicolombo-mercury',
    title: 'BepiColombo begins its final approach to Mercury orbit',
    items: [{
      title: "Spacecraft bound for Mercury begins 'tricky' arrival",
      description: 'After an eight-year journey, a spacecraft carrying European and Japanese probes began the monthslong, high-risk approach to Mercury to study the sun-scorched planet.',
    }],
  },
  {
    // health-biotech
    slug: 'eight-letter-dna',
    title: 'Cellular enzyme reads an eight-letter genetic alphabet',
    items: [{
      title: 'Life uses 4 DNA letters. Scientists just made 8 work',
      description: 'Researchers at UC San Diego demonstrated that a key cellular enzyme can accurately read an eight-letter genetic alphabet, doubling the four letters used by all known life. Imaging revealed that RNA polymerase handles synthetic DNA letters in surprisingly similar ways to natural ones.',
    }],
  },
  {
    // ── climate-energy · industry-policy 대체 후보 (2026-09-06) ──────
    // climate-energy
    slug: 'puerto-rico-drought',
    title: 'Extreme drought spreads across Puerto Rico during its rainy season',
    items: [{
      title: 'Extreme drought now covers 44% of Puerto Rico',
      description: "Puerto Rico's normally rainy season has instead brought a severe and fast-growing drought. By August 25, three-quarters of the territory was in at least moderate drought, with extreme drought covering 44 percent and some areas receiving less than 20 percent of their usual rainfall. Water shortages have forced rationing and farmers are losing crops.",
    }],
  },
  {
    // climate-energy
    slug: 'nanowire-led',
    title: 'Branched nanowire LED design cuts optical losses',
    items: [{
      title: 'A new type of LED light could bring significant efficiency gains',
      description: 'Researchers at Lund University have developed a light-emitting diode based on thin, branched nanowires that could offer higher efficiency and lower production costs than current technology. By controlling where in the structure the light is generated, they reduced the losses that would otherwise limit the amount of light that can be used.',
    }],
  },
  {
    // industry-policy
    slug: 'genai-manager-judgment',
    title: 'Study links heavy generative AI use to eroded managerial judgment',
    items: [{
      title: "AI could undermine managers' judgment unless used carefully, study warns",
      description: "Generative artificial intelligence has become a routine part of working life, but overreliance on the technology may erode managers' ability to build moral insights, contextual understanding and the know-how to get a job done, according to a new study from the University of Bath.",
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
