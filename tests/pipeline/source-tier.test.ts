import { describe, expect, it } from 'vitest';

import { classifySource, filterSources, normalizeHost } from '@/pipeline/research/source-tier';

describe('normalizeHost', () => {
  it('www 를 떼고 소문자로', () => {
    expect(normalizeHost('https://WWW.Nature.COM/articles/x')).toBe('nature.com');
  });

  it('URL 이 아니면 null', () => {
    expect(normalizeHost('not a url')).toBeNull();
  });
});

describe('classifySource — Tier 1', () => {
  const cases = [
    ['https://www.nature.com/articles/s41586', 'nature.com'],
    ['https://arxiv.org/abs/2601.00001', 'arxiv.org'],
    ['https://www.nasa.gov/news-release/x', 'nasa.gov'],
    ['https://eurekalert.org/news-releases/1', 'eurekalert.org'],
    ['https://home.cern/news/x', 'home.cern'],
  ] as const;

  for (const [url, matched] of cases) {
    it(url.slice(0, 46), () => {
      const v = classifySource(url);
      expect(v.tier).toBe(1);
      if (v.tier) expect(v.matched).toBe(matched);
    });
  }

  it('서브도메인도 걸린다', () => {
    expect(classifySource('https://blogs.nature.com/x').tier).toBe(1);
  });

  it('.edu / .gov 접미사는 Tier 1', () => {
    expect(classifySource('https://news.mit.edu/2026/x').tier).toBe(1);
    expect(classifySource('https://www.energy.gov/articles/x').tier).toBe(1);
    expect(classifySource('https://www.cam.ac.uk/research/x').tier).toBe(1);
  });
});

describe('classifySource — Tier 2', () => {
  it('주요 언론은 Tier 2', () => {
    expect(classifySource('https://www.reuters.com/science/x').tier).toBe(2);
    expect(classifySource('https://arstechnica.com/space/x').tier).toBe(2);
  });
});

describe('classifySource — 제외', () => {
  it('피드로 쓰는 애그리게이터도 출처로는 제외한다', () => {
    // phys.org 와 sciencedaily 는 우리 피드(D-16)지만 기관 보도자료의 재게시본이다.
    // 원문 보도자료를 쓰면 되고, 재게시본을 인용하면 한 다리 건넌 셈이 된다
    const physOrg = classifySource('https://phys.org/news/2026-09-x.html');
    expect(physOrg.tier).toBeNull();
    if (physOrg.tier === null) expect(physOrg.reason).toBe('blocked');

    expect(classifySource('https://www.sciencedaily.com/releases/x.htm').tier).toBeNull();
  });

  it('소셜·포럼은 제외', () => {
    for (const url of [
      'https://www.reddit.com/r/science/x',
      'https://x.com/user/status/1',
      'https://news.ycombinator.com/item?id=1',
      'https://en.wikipedia.org/wiki/X',
    ]) {
      expect(classifySource(url).tier, url).toBeNull();
    }
  });

  it('강한 페이월은 fetch 전에 제외한다', () => {
    expect(classifySource('https://www.wsj.com/articles/x').tier).toBeNull();
  });

  it('모르는 도메인은 쓰지 않는다', () => {
    const v = classifySource('https://random-tech-blog.example/post');
    expect(v.tier).toBeNull();
    if (v.tier === null) expect(v.reason).toBe('unknown');
  });

  it('차단이 tier 판정보다 먼저다', () => {
    // 애그리게이터가 대학 도메인에 얹혀 있어도 차단이 이긴다
    expect(classifySource('https://medium.com/@someone/post').tier).toBeNull();
  });

  it('비슷한 이름에 걸리지 않는다', () => {
    expect(classifySource('https://notnature.com/x').tier).toBeNull();
    expect(classifySource('https://fakereddit.com/x').tier).toBeNull();
  });

  it('깨진 URL 은 invalid-url', () => {
    const v = classifySource('그냥 문자열');
    expect(v.tier).toBeNull();
    if (v.tier === null) expect(v.reason).toBe('invalid-url');
  });
});

describe('filterSources', () => {
  it('혼합 목록을 올바르게 거른다', () => {
    const { accepted, rejected } = filterSources([
      'https://phys.org/news/x',
      'https://www.reuters.com/science/x',
      'https://arxiv.org/abs/1',
      'https://random.example/x',
      'https://www.reddit.com/r/x',
    ]);

    expect(accepted.map((s) => s.tier)).toEqual([1, 2]);
    expect(accepted[0]!.url).toContain('arxiv');
    expect(rejected).toHaveLength(3);
  });

  it('Tier 1 을 앞에 둔다 (3.10 의 Tier 1 규칙)', () => {
    const { accepted } = filterSources([
      'https://www.bbc.com/news/x',
      'https://www.nature.com/articles/x',
      'https://arstechnica.com/x',
    ]);
    expect(accepted[0]!.tier).toBe(1);
  });

  it('같은 tier 안에서는 검색 순위를 유지한다', () => {
    const { accepted } = filterSources([
      'https://www.bbc.com/a',
      'https://www.reuters.com/b',
    ]);
    expect(accepted.map((s) => s.url)).toEqual([
      'https://www.bbc.com/a',
      'https://www.reuters.com/b',
    ]);
  });

  it('같은 매체의 두 번째 기사는 제외한다', () => {
    // 출처를 늘린 게 아니라 같은 얘기를 두 번 세는 것이다
    const { accepted, rejected } = filterSources([
      'https://www.nature.com/articles/a',
      'https://www.nature.com/articles/b',
    ]);
    expect(accepted).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('duplicate-host');
  });

  it('빈 목록', () => {
    expect(filterSources([])).toEqual({ accepted: [], rejected: [] });
  });
});
