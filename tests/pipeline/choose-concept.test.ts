import { describe, expect, it } from 'vitest';

import { chooseCoverConcept } from '@/pipeline/illustrate/choose-concept';
import { buildArticleBrief, CONCEPT_INSTRUCTIONS } from '@/prompts/cover-concept';

import type { AnthropicClient } from '@/clients/anthropic';

/**
 * 커버 장면 선택 (로드맵 5.2, D-38).
 *
 * 네트워크를 타지 않는다. 고른 장면이 좋은지는 사람이 `pnpm covers:bakeoff` 로 본다.
 * 여기서 지키는 것은 **못 쓸 출력을 통과시키지 않는 것**이다 —
 * 빈 장면이 나가면 이미지 모델이 알아서 지어내고, 그게 D-37 의 색면이었다.
 */

const article = {
  title: 'Underground detector records a flash it cannot explain',
  oneLineSummary: 'The odds that background noise produced the signal are one in two hundred.',
  sections: [
    {
      heading: 'What the detector saw',
      paragraphs: ['The experiment recorded a single flash of light.', '두 번째 문단'],
    },
    {
      heading: 'How the detector works',
      paragraphs: ['The instrument is a tank holding seven tonnes of liquid xenon.'],
    },
  ],
};

function fakeClaude(output: unknown) {
  const prompts: string[] = [];

  const claude = {
    messages: {
      parse: async ({ messages }: { messages: { content: string }[] }) => {
        prompts.push(messages[0]!.content);
        return {
          parsed_output: output,
          usage: {
            input_tokens: 500,
            output_tokens: 80,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  };

  return { claude: claude as unknown as AnthropicClient, prompts };
}

const good = {
  mode: 'subject',
  scene: 'A drum-shaped tank deep underground, rock layers stacked above it.',
  rationale: 'The article is about a specific instrument, so show the instrument.',
};

describe('chooseCoverConcept', () => {
  it('고른 장면과 유형을 돌려준다', async () => {
    const { claude } = fakeClaude(good);
    const result = await chooseCoverConcept(claude, article);

    expect(result.failure).toBeNull();
    expect(result.concept?.mode).toBe('subject');
    expect(result.concept?.scene).toContain('drum-shaped tank');
    expect(result.usage.inputTokens).toBe(500);
  });

  it('유형이 셋 밖이면 실패다', async () => {
    // mode 는 나중에 "어느 유형이 잘 나오나" 를 세는 데 쓴다. 값이 새면 셀 수 없다
    const { claude } = fakeClaude({ ...good, mode: 'abstract' });
    const result = await chooseCoverConcept(claude, article);

    expect(result.failure).toBe('unparsable');
    expect(result.concept).toBeNull();
  });

  it('장면이 비면 실패다 — 빈 장면은 이미지 모델이 지어낸다', async () => {
    const { claude } = fakeClaude({ ...good, scene: '  dark matter  ' });
    const result = await chooseCoverConcept(claude, article);

    expect(result.failure).toBe('empty-scene');
  });

  it('실패해도 사용량은 돌려준다 — 비용은 이미 나갔다', async () => {
    const { claude } = fakeClaude({ ...good, scene: '' });
    const result = await chooseCoverConcept(claude, article);

    expect(result.usage.outputTokens).toBe(80);
  });
});

describe('buildArticleBrief', () => {
  it('섹션마다 소제목과 첫 문장만 넣는다', async () => {
    const brief = buildArticleBrief(article);

    expect(brief).toContain('What the detector saw');
    expect(brief).toContain('The experiment recorded a single flash of light.');
    // 본문 전체를 싣지 않는다. 장면을 고르는 데 요지면 충분하고, 토큰은 돈이다
    expect(brief).not.toContain('두 번째 문단');
  });

  it('프롬프트가 기사 요지 뒤에 온다', async () => {
    const { claude, prompts } = fakeClaude(good);
    await chooseCoverConcept(claude, article);

    expect(prompts[0]!.indexOf('TITLE:')).toBe(0);
    expect(prompts[0]).toContain(CONCEPT_INSTRUCTIONS);
  });
});
