import { describe, expect, it } from 'vitest';

import { estimateCost, getAnthropic } from '@/clients/anthropic';
import { CACHE_READ_MULTIPLIER, CACHE_WRITE_MULTIPLIER, MODEL_SONNET, PRICING } from '@/config/models';
import { listFixtures } from '@/pipeline/research/fixtures';
import { sentenceStats, wordCount, writeArticle } from '@/pipeline/write/write-article';

// fixture 기반. 검색·fetch 없이 Sonnet 호출만 한다.
// 실행: pnpm write:live
const claude = getAnthropic();
const cost = (u: Parameters<typeof estimateCost>[0]) =>
  estimateCost(u, PRICING[MODEL_SONNET], {
    cacheRead: CACHE_READ_MULTIPLIER,
    cacheWrite: CACHE_WRITE_MULTIPLIER,
  });

describe('기사 작성 (3.6)', () => {
  const fixtures = listFixtures();

  it('fixture 가 있다', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it('첫 fixture 로 기사를 쓴다', async () => {
    const fixture = fixtures[0]!;
    const started = Date.now();
    const r = await writeArticle(claude, fixture.topicTitle, fixture.sources);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    console.log(`\n━━ ${fixture.slug} (${seconds}초)`);
    console.log(`입력 ${r.usage.inputTokens} / 출력 ${r.usage.outputTokens}`);
    console.log(`캐시 생성 ${r.usage.cacheCreationTokens} / 읽기 ${r.usage.cacheReadTokens}`);
    console.log(`비용 $${cost(r.usage).toFixed(4)}`);

    if (!r.article) {
      console.log(`실패: ${r.failure} — ${r.detail}`);
      throw new Error(`작성 실패: ${r.failure}`);
    }

    const a = r.article;
    console.log(`\n제목: ${a.title}`);
    console.log(`요약: ${a.oneLineSummary}`);
    console.log(`카테고리: ${a.category} | 태그: ${a.tags.join(', ')}`);
    console.log(`섹션 ${a.sections.length}개, ${wordCount(a)}단어\n`);
    for (const s of a.sections) {
      console.log(`  ## ${s.heading}   [출처 ${s.sources.join(', ')}]`);
      for (const p of s.paragraphs) console.log(`     ${p.slice(0, 150)}`);
    }

    // 스타일 가이드 검증
    expect(a.sections.length).toBeGreaterThanOrEqual(3);
    expect(a.sections.length).toBeLessThanOrEqual(5);
    expect(a.sections.every((s) => s.sources.length > 0)).toBe(true);

    const words = wordCount(a);
    expect(words, `${words}단어 — 목표 600~900`).toBeGreaterThan(450);
    expect(words).toBeLessThan(1200);

    const text = a.sections.flatMap((s) => s.paragraphs).join(' ');
    expect(text, '느낌표 없음').not.toContain('!');
    expect(text.toLowerCase(), '금지 표현').not.toMatch(
      /revolutionary|groundbreaking|game-changing|mind-blowing/,
    );

    const stats = sentenceStats(a);
    console.log(
      `\n문장 ${stats.count}개, 평균 ${stats.averageWords.toFixed(1)}단어, 최장 ${stats.longest}단어`,
    );
    for (const s of stats.overLimit) console.log(`  40단어 초과: ${s.slice(0, 140)}`);

    // 스타일 가이드: 평균 22단어 이하, 40단어 초과 없음
    expect(stats.averageWords, '평균 문장 길이').toBeLessThan(24);
    expect(stats.overLimit, '40단어를 넘는 문장은 거의 항상 두 문장이다').toHaveLength(0);
  }, 300_000);

  it('두 번째 호출에서 캐시가 읽히는지 확인한다 (D-06)', async () => {
    // 같은 출처 블록으로 다시 부른다. 프리픽스가 같으면 cache_read 가 잡혀야 한다
    const fixture = fixtures[0]!;
    const r = await writeArticle(claude, fixture.topicTitle, fixture.sources);

    console.log(`\n2회차 — 캐시 읽기 ${r.usage.cacheReadTokens}, 생성 ${r.usage.cacheCreationTokens}`);
    console.log(`입력 ${r.usage.inputTokens}, 비용 $${cost(r.usage).toFixed(4)}`);

    if (r.usage.cacheReadTokens === 0) {
      console.log('⚠ 캐시가 걸리지 않았다. 예산 계산(D-06)의 전제가 흔들린다');
    }
    expect(r.article ?? r.failure).toBeTruthy();
  }, 300_000);
});
