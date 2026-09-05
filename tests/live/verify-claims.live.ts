import { describe, expect, it } from 'vitest';

import { estimateCost, getAnthropic } from '@/clients/anthropic';
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  MODEL_SONNET,
  PRICING,
} from '@/config/models';
import { listFixtures } from '@/pipeline/research/fixtures';
import { verifyArticle } from '@/pipeline/verify/verify-claims';
import { writeArticle, type WrittenArticle } from '@/pipeline/write/write-article';

// 실행: pnpm verify:live
const claude = getAnthropic();
const cost = (u: Parameters<typeof estimateCost>[0]) =>
  estimateCost(u, PRICING[MODEL_SONNET], {
    cacheRead: CACHE_READ_MULTIPLIER,
    cacheWrite: CACHE_WRITE_MULTIPLIER,
  });

/** 기사에서 첫 번째 큰 숫자를 찾는다 */
function findNumber(article: WrittenArticle): { raw: string; value: number } | null {
  for (const section of article.sections) {
    for (const paragraph of section.paragraphs) {
      const match = /\b(\d{1,3}(?:,\d{3})+|\d{4,})\b/.exec(paragraph);
      if (match) return { raw: match[1]!, value: Number(match[1]!.replace(/,/g, '')) };
    }
  }
  return null;
}

function replaceEverywhere(article: WrittenArticle, from: string, to: string): WrittenArticle {
  return {
    ...article,
    sections: article.sections.map((s) => ({
      ...s,
      paragraphs: s.paragraphs.map((p) => p.split(from).join(to)),
    })),
  };
}

describe('근거 검증 (3.7, 3.8)', () => {
  const fixture = listFixtures().find((f) => f.slug === 'fly-connectome') ?? listFixtures()[0]!;

  it('원본 → 조작 → 표기변경 순으로 대조한다', async () => {
    const written = await writeArticle(claude, fixture.topicTitle, fixture.sources);
    if (!written.article) throw new Error(`작성 실패: ${written.failure}`);
    const article = written.article;

    // ── 1. 원본 ──────────────────────────────────────────
    const baseline = await verifyArticle(claude, article, fixture.sources);
    console.log(`\n━━ 원본`);
    console.log(`진술 ${baseline.claims.length}개, 근거 없음 ${baseline.unsupported.length}개`);
    console.log(`비용 $${cost(baseline.usage).toFixed(4)}, 통과: ${baseline.passed}`);
    for (const u of baseline.unsupported.slice(0, 6)) {
      console.log(`  ✗ "${u.claim.text.slice(0, 82)}"`);
      console.log(`    → ${u.note.slice(0, 96)}`);
    }

    const target = findNumber(article);
    if (!target) throw new Error('기사에서 숫자를 찾지 못했다');
    console.log(`\n조작 대상 숫자: ${target.raw}`);

    // ── 2. 숫자를 조작한다 (걸려야 한다) ─────────────────
    const fabricatedValue = target.value * 3 + 7;
    const fabricated = replaceEverywhere(article, target.raw, fabricatedValue.toLocaleString('en-US'));
    const afterFabrication = await verifyArticle(claude, fabricated, fixture.sources);

    const caught = afterFabrication.unsupported.some((u) =>
      u.claim.text.includes(fabricatedValue.toLocaleString('en-US')) ||
      u.claim.text.includes(String(fabricatedValue)),
    );
    console.log(`\n━━ 조작 (${target.raw} → ${fabricatedValue.toLocaleString('en-US')})`);
    console.log(`근거 없음 ${afterFabrication.unsupported.length}개, 조작 숫자 적발: ${caught}`);
    for (const u of afterFabrication.unsupported.slice(0, 4)) {
      console.log(`  ✗ "${u.claim.text.slice(0, 82)}"`);
    }

    // ── 3. 표기만 바꾼다 (걸리면 안 된다) ────────────────
    const reformatted = replaceEverywhere(article, target.raw, String(target.value));
    const afterReformat = await verifyArticle(claude, reformatted, fixture.sources);

    const falsePositive = afterReformat.unsupported.filter(
      (u) => u.claim.text.includes(String(target.value)) &&
        !baseline.unsupported.some((b) => b.claim.text.includes(target.raw)),
    );
    console.log(`\n━━ 표기 변경 (${target.raw} → ${target.value})`);
    console.log(`근거 없음 ${afterReformat.unsupported.length}개, 표기 때문에 걸린 것 ${falsePositive.length}개`);
    for (const u of falsePositive) console.log(`  ⚠ "${u.claim.text.slice(0, 82)}"`);

    // ── 판정 ─────────────────────────────────────────────
    expect(baseline.error).toBeNull();
    expect(baseline.claims.length, '진술이 추출돼야 한다').toBeGreaterThan(5);
    expect(caught, '조작한 숫자가 적발되지 않았다').toBe(true);
    expect(falsePositive, '표기만 다른 참값이 근거 없음으로 걸렸다').toHaveLength(0);
  }, 900_000);
});
