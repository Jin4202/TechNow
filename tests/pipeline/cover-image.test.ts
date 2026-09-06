import { describe, expect, it } from 'vitest';

import { buildCoverPrompt, STYLE_PREFIX, subjectLine } from '@/prompts/cover-image';

/**
 * 커버 이미지 프롬프트 (로드맵 5.2).
 *
 * 지키려는 것은 두 가지다:
 *   - 브랜드·인물이 프롬프트에 들어가지 않는다 (CLAUDE.md §5)
 *   - 화풍이 모든 기사에서 같다 — 목록 페이지에 카드가 나란히 보인다
 */

describe('subjectLine', () => {
  it('회사 이름을 지운다', () => {
    // 로고가 그려지는 것을 프롬프트에 부탁해서 막지 않는다. 단어를 넣지 않는다
    const subject = subjectLine(
      'Google says its quantum chip solved a problem in minutes',
      'The claim rests on a benchmark that classical computers find hard.',
    );

    expect(subject.toLowerCase()).not.toContain('google');
    expect(subject).toContain('quantum chip');
  });

  it('사람 이름처럼 생긴 것을 지운다', () => {
    const subject = subjectLine(
      'Greg Jefferis and colleagues finish the fly connectome',
      'The map covers every neuron in a male fruit fly.',
    );

    expect(subject).not.toContain('Greg Jefferis');
    expect(subject).toContain('connectome');
  });

  it('지운 자리에 공백과 구두점이 남지 않는다', () => {
    const subject = subjectLine('Google announces a chip', 'A test.');

    expect(subject).not.toMatch(/\s{2,}/);
    expect(subject).not.toMatch(/\s[,.]/);
  });

  it('고유명사가 없는 제목은 그대로 둔다', () => {
    const subject = subjectLine(
      'Underground detector records a flash it cannot explain',
      'The odds that background noise produced it are one in two hundred.',
    );

    expect(subject).toContain('Underground detector records a flash it cannot explain');
  });
});

describe('buildCoverPrompt', () => {
  it('스타일이 주제보다 앞에 온다', () => {
    // 이미지 모델은 앞쪽 토큰에 더 크게 반응한다.
    // 주제를 앞에 두면 기사마다 화풍이 흔들린다
    const prompt = buildCoverPrompt('A new detector', 'It looks for dark matter.');

    expect(prompt.indexOf(STYLE_PREFIX)).toBe(0);
    expect(prompt).toContain('The subject: A new detector');
  });

  it('스타일 프리픽스가 금지 사항을 담고 있다', () => {
    // 글자·사람·로고. 셋 다 CLAUDE.md §5 이거나 모델의 알려진 약점이다
    for (const banned of ['No text', 'No people', 'no logos']) {
      expect(STYLE_PREFIX).toContain(banned);
    }
  });
});
