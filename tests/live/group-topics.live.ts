import { describe, expect, it } from 'vitest';

import { getAnthropic } from '@/clients/anthropic';
import { feeds } from '@/config/feeds';
import { applyCheapFilters } from '@/pipeline/discover/cheap-filters';
import { dedupeItems, fetchFeeds } from '@/pipeline/discover/fetch-feeds';
import { groupTopics } from '@/pipeline/group/group-topics';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

// 실제 피드 + 실제 Claude 호출. 한 번에 5센트 안팎.
// 실행: pnpm group:live
const client = getAnthropic();

const synthetic = (title: string, description: string): FeedItem => ({
  urlHash: title,
  feedName: 'synthetic',
  title,
  description,
  url: `https://example.org/${encodeURIComponent(title)}`,
  publishedAt: null,
});

describe('그룹핑 (2.2, 2.3)', () => {
  it('같은 사건을 다룬 두 항목이 한 토픽으로 묶인다', async () => {
    // 서로 다른 매체가 같은 발표를 다룬 형태
    const items = [
      synthetic(
        'NASA confirms water ice at Mars south pole',
        'The agency said radar data from its orbiter shows a large deposit of water ice beneath the Martian south polar cap.',
      ),
      synthetic(
        'Radar finds buried ice sheet on Mars, NASA says',
        'A new analysis of orbiter radar returns points to a substantial water ice layer under the south pole of Mars.',
      ),
      synthetic(
        'New lithium battery doubles cycle life in lab tests',
        'Researchers report a cathode coating that kept capacity above 80 percent after 4,000 charge cycles.',
      ),
    ];

    const { topics, usedFallback } = await groupTopics(client, items, []);
    expect(usedFallback, '폴백이 아니라 실제 그룹핑이어야 한다').toBe(false);

    const marsTopic = topics.find((t) => t.items.some((i) => i.title.includes('NASA confirms')));
    expect(marsTopic!.items).toHaveLength(2);

    // 배터리는 별개 토픽
    const batteryTopic = topics.find((t) => t.items.some((i) => i.title.includes('lithium')));
    expect(batteryTopic!.items).toHaveLength(1);
  }, 120_000);

  it('기발행 기사의 후속을 follow-up 으로 표시한다', async () => {
    const items = [
      synthetic(
        'Mars orbiter returns first images of the new ice deposit',
        'Follow-up imaging shows the surface above the deposit identified last week.',
      ),
      synthetic(
        'Fusion reactor sustains plasma for 20 minutes',
        'An unrelated milestone at a tokamak facility.',
      ),
    ];
    const recent = [
      { id: 'article-mars', title: 'NASA confirms water ice at Mars south pole' },
      { id: 'article-chip', title: 'New 2nm chip process enters risk production' },
    ];

    const { topics, usedFallback } = await groupTopics(client, items, recent);
    expect(usedFallback).toBe(false);

    const marsTopic = topics.find((t) => t.items.some((i) => i.title.includes('Mars orbiter')));
    expect(marsTopic!.followUpOfArticleId, 'Mars 후속으로 판정돼야 한다').toBe('article-mars');

    const fusionTopic = topics.find((t) => t.items.some((i) => i.title.includes('Fusion')));
    expect(fusionTopic!.followUpOfArticleId, '무관한 토픽은 null').toBeNull();
  }, 120_000);

  it('실제 수집분 전량을 그룹핑한다', async () => {
    const { items } = await fetchFeeds(feeds);
    const { kept } = applyCheapFilters(dedupeItems(items));

    const start = Date.now();
    const { topics, usage, usedFallback } = await groupTopics(client, kept, []);
    const seconds = ((Date.now() - start) / 1000).toFixed(1);

    const grouped = topics.filter((t) => t.items.length > 1);
    const cost = (usage.inputTokens / 1e6) * 1 + (usage.outputTokens / 1e6) * 5;

    console.log(`\n후보 ${kept.length}건 → 토픽 ${topics.length}개 (${seconds}초)`);
    console.log(`입력 ${usage.inputTokens} / 출력 ${usage.outputTokens} 토큰, 약 $${cost.toFixed(4)}`);
    console.log(`2건 이상 묶인 토픽 ${grouped.length}개:`);
    for (const t of grouped.slice(0, 8)) {
      console.log(`  · ${t.title.slice(0, 66)}`);
      for (const i of t.items) console.log(`      [${i.feedName}] ${i.title.slice(0, 62)}`);
    }

    expect(usedFallback).toBe(false);

    // 항목이 하나도 유실되지 않는다. 이게 핵심 불변식이다 —
    // 여기서 사라진 항목은 processed 로 넘어가 영영 후보가 못 된다
    const covered = topics.flatMap((t) => t.items.map((i) => i.urlHash));
    expect(new Set(covered).size).toBe(kept.length);
    expect(covered.length, '한 항목이 두 토픽에 들어가면 안 된다').toBe(kept.length);

    // 그룹핑이 항목 수를 늘리지는 않는다
    expect(topics.length).toBeLessThanOrEqual(kept.length);

    // 묶임 여부는 그날 뉴스에 달렸다. 5개 피드의 취재 영역이 달라서
    // 겹치는 날이 오히려 드물다 — 여기서 0개여도 실패가 아니다.
    // 병합 자체가 되는지는 위의 합성 데이터 테스트가 지킨다
  }, 300_000);
});
