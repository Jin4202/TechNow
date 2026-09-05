import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  applyCheapFilters,
  rejectReason,
  summarizeRejections,
} from '@/pipeline/discover/cheap-filters';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

const item = (title: string, feedName = 'f'): FeedItem => ({
  urlHash: title,
  feedName,
  title,
  description: 'x'.repeat(300),
  url: 'https://example.org/x',
  publishedAt: null,
});

describe('rejectReason — 걸러야 하는 것', () => {
  const cases: [string, string][] = [
    // 실제 수집된 IEEE Spectrum 제목들
    ['IEEE President’s Note: Technology for Social Good', 'organizational'],
    ['IEEE Senior Membership Demystified', 'organizational'],
    ['IEEE Student Conference Provides Visibility to Budding Authors', 'organizational'],
    ['IEEE Presidents’ Scholarship Honors Teen Innovators', 'organizational'],
    ['Applying Different Forms of Mentorship', 'organizational'],
    ['What It Takes to Be an Adaptable Engineer', 'organizational'],
    ['Poetry for Engineers: Safe Distance', 'organizational'],
    // 부고
    ['Digital Signal Processing Pioneer Bede Liu Dies At 91', 'obituary'],
    // 실제 수집된 phys.org 사회과학
    ['Study reveals pupils most at risk of school suspension and what may help them', 'off-topic'],
    ['Same-sex marriages surged before Bolsonaro took office, Brazil data reveal', 'off-topic'],
    ['Mosque workshops help Muslim women discuss reproductive health in NSW', 'off-topic'],
    // 홍보성 (표본에는 없었지만 나올 수 있는 형태)
    ['The best laptops of 2026 for students', 'promotional'],
    ['Save $200 on this robot vacuum deal', 'promotional'],
    // 너무 짧음
    ['Short one', 'too-short'],
  ];

  for (const [title, reason] of cases) {
    it(`[${reason}] ${title.slice(0, 52)}`, () => {
      expect(rejectReason(item(title))).toBe(reason);
    });
  }
});

describe('rejectReason — 통과해야 하는 것', () => {
  // 전부 실제 수집된 제목. 하나라도 걸리면 위양성이다
  const keep = [
    'Magic-angle graphene provides evidence for unconventional superconductivity',
    'Second complete map of a fruit fly brain completed',
    'A New NASA Design Turbocharges Nuclear Spacecraft',
    'Atomically Thin Materials Significantly Shrink Qubits',
    'How AI Will Change Chip Design',
    'The E.U.’s AI Drive Undermines Its Own Chip Strategy',
    'New AI tool maps the hidden universe of small molecules',
    'Periodical cicadas may be doomed to extinction',
    'How Mercury formed its graphite crust and core',
    'OpenAI agents discussed ways to escape their sandbox on public wiki',
    'Deadly floods of 2021—Researchers identify gaps in hazard mapping',
    'IBM Built the Cold War’s Most Powerful Code Breaker for the NSA',
    'A new type of LED light could bring significant efficiency gains',
    'Turbulent times for star formation in Stephan’s Quintet',
  ];

  for (const title of keep) {
    it(`통과: ${title.slice(0, 52)}`, () => {
      expect(rejectReason(item(title))).toBeNull();
    });
  }
});

describe('설명 길이는 신호가 아니다', () => {
  it('설명이 짧아도 통과한다', () => {
    // Ars Technica 의 설명은 48~115자다. 길이로 거르면 좋은 기사가 죽는다
    const short: FeedItem = {
      ...item('Second complete map of a fruit fly brain completed'),
      description: '짧다',
    };
    expect(rejectReason(short)).toBeNull();
  });
});

describe('실제 수집분 150건에 적용', () => {
  const titles = readFileSync('fixtures/feeds/titles-2026-09-05.tsv', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [feedName, title] = line.split('\t');
      return item(title!, feedName!);
    });

  const result = applyCheapFilters(titles);

  it('fixture 가 150건이다', () => {
    expect(titles).toHaveLength(150);
  });

  it('탈락률이 25% 를 넘지 않는다', () => {
    // 저비용 필터는 명백한 잡음만 걷어낸다. 많이 죽이면 위양성을 의심해야 한다
    const rate = result.rejected.length / titles.length;
    expect(rate, `탈락 ${result.rejected.length}건: ${JSON.stringify(summarizeRejections(result.rejected))}`).toBeLessThan(0.25);
  });

  it('절반 이상은 통과한다', () => {
    expect(result.kept.length).toBeGreaterThan(titles.length / 2);
  });

  it('탈락 사유가 알려진 규칙 중 하나다', () => {
    const known = new Set(['too-short', 'promotional', 'organizational', 'obituary', 'off-topic']);
    for (const r of result.rejected) expect(known).toContain(r.reason);
  });
});
