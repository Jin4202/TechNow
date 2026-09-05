import { describe, expect, it, vi } from 'vitest';

import { thresholds } from '@/config/thresholds';
import { scoreTopics } from '@/pipeline/score/score-topics';
import { buildScoringPrompt } from '@/prompts/score-topics';

import type { AnthropicClient } from '@/clients/anthropic';
import type { ScoringTopicInput } from '@/prompts/score-topics';

const topic = (title: string): ScoringTopicInput => ({
  title,
  items: [{ title, description: `${title} 설명` }],
});

const axis = (score: number) => ({ score, reason: 'r' });

/** parse() 만 흉내내는 최소 스텁 */
function stubClient(
  handler: (topicCount: number, call: number) => { scores: unknown[] } | Error,
): AnthropicClient {
  let call = 0;
  return {
    messages: {
      parse: vi.fn(async ({ messages }: { messages: { content: string }[] }) => {
        const count = (messages[0]!.content.match(/^Topic \d+:/gm) ?? []).length;
        const result = handler(count, call++);
        if (result instanceof Error) throw result;
        return {
          parsed_output: result,
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }),
    },
  } as unknown as AnthropicClient;
}

describe('scoreTopics', () => {
  it('빈 입력은 호출하지 않는다', async () => {
    const client = stubClient(() => ({ scores: [] }));
    const r = await scoreTopics(client, []);
    expect(r.scored).toEqual([]);
    expect(client.messages.parse).not.toHaveBeenCalled();
  });

  it('청크를 넘어 인덱스를 올바르게 매긴다', async () => {
    // 청크 크기보다 많은 토픽을 넣어 두 번 이상 호출되게 한다
    const count = thresholds.scoringChunkSize + 5;
    const topics = Array.from({ length: count }, (_, i) => topic(`T${i}`));

    const client = stubClient((topicCount) => ({
      scores: Array.from({ length: topicCount }, (_, i) => ({
        topicNumber: i + 1,
        novelty: axis(3),
        impact: axis(4),
        interest: axis(5),
      })),
    }));

    const r = await scoreTopics(client, topics);
    expect(r.scored).toHaveLength(count);
    expect(r.unscored).toEqual([]);
    // 전체 인덱스가 빠짐없이 한 번씩
    expect(r.scored.map((s) => s.index).sort((a, b) => a - b)).toEqual(
      Array.from({ length: count }, (_, i) => i),
    );
  });

  it('총점은 세 축의 합이다', async () => {
    const client = stubClient(() => ({
      scores: [{ topicNumber: 1, novelty: axis(3), impact: axis(4), interest: axis(5) }],
    }));
    const r = await scoreTopics(client, [topic('T')]);
    expect(r.scored[0]!.total).toBe(12);
  });

  it('범위를 벗어난 점수를 1~5로 조인다', async () => {
    // DB check 제약(1~5)에 걸리기 전에 잡아야 한다
    const client = stubClient(() => ({
      scores: [{ topicNumber: 1, novelty: axis(9), impact: axis(0), interest: axis(3.6) }],
    }));
    const r = await scoreTopics(client, [topic('T')]);
    expect(r.scored[0]!.novelty.score).toBe(5);
    expect(r.scored[0]!.impact.score).toBe(1);
    expect(r.scored[0]!.interest.score).toBe(4);
  });

  it('청크 하나가 실패해도 나머지는 채점된다', async () => {
    const count = thresholds.scoringChunkSize + 3;
    const topics = Array.from({ length: count }, (_, i) => topic(`T${i}`));

    const client = stubClient((topicCount, call) => {
      if (call === 0) return new Error('레이트 리밋');
      return {
        scores: Array.from({ length: topicCount }, (_, i) => ({
          topicNumber: i + 1,
          novelty: axis(3),
          impact: axis(3),
          interest: axis(3),
        })),
      };
    });

    const r = await scoreTopics(client, topics);
    expect(r.failedChunks).toHaveLength(1);
    // 실패한 청크의 토픽은 버려지지 않고 unscored 로 남는다
    expect(r.unscored).toHaveLength(thresholds.scoringChunkSize);
    expect(r.scored).toHaveLength(3);
  });

  it('모델이 빠뜨린 토픽은 unscored 로 남는다', async () => {
    const client = stubClient(() => ({
      scores: [{ topicNumber: 1, novelty: axis(3), impact: axis(3), interest: axis(3) }],
    }));
    const r = await scoreTopics(client, [topic('A'), topic('B'), topic('C')]);
    expect(r.scored).toHaveLength(1);
    expect(r.unscored).toEqual([1, 2]);
  });

  it('같은 번호가 두 번 오면 먼저 온 것만 쓴다', async () => {
    const client = stubClient(() => ({
      scores: [
        { topicNumber: 1, novelty: axis(5), impact: axis(5), interest: axis(5) },
        { topicNumber: 1, novelty: axis(1), impact: axis(1), interest: axis(1) },
      ],
    }));
    const r = await scoreTopics(client, [topic('A')]);
    expect(r.scored).toHaveLength(1);
    expect(r.scored[0]!.total).toBe(15);
  });

  it('범위 밖 topicNumber 는 버린다', async () => {
    const client = stubClient(() => ({
      scores: [
        { topicNumber: 99, novelty: axis(3), impact: axis(3), interest: axis(3) },
        { topicNumber: 1, novelty: axis(3), impact: axis(3), interest: axis(3) },
      ],
    }));
    const r = await scoreTopics(client, [topic('A')]);
    expect(r.scored).toHaveLength(1);
    expect(r.scored[0]!.index).toBe(0);
  });

  it('토큰 사용량을 청크별로 합산한다', async () => {
    const topics = Array.from({ length: thresholds.scoringChunkSize + 1 }, (_, i) => topic(`T${i}`));
    const client = stubClient((topicCount) => ({
      scores: Array.from({ length: topicCount }, (_, i) => ({
        topicNumber: i + 1,
        novelty: axis(3),
        impact: axis(3),
        interest: axis(3),
      })),
    }));
    const r = await scoreTopics(client, topics);
    expect(r.usage.inputTokens).toBe(20); // 청크 2개 × 10
    expect(r.usage.outputTokens).toBe(10);
  });
});

describe('buildScoringPrompt', () => {
  it('토픽을 1부터 번호 매긴다', () => {
    const p = buildScoringPrompt([topic('첫째'), topic('둘째')]);
    expect(p).toContain('Topic 1: 첫째');
    expect(p).toContain('Topic 2: 둘째');
  });

  it('follow-up 이면 원본 기사 제목을 넣는다', () => {
    const p = buildScoringPrompt([{ ...topic('후속'), followUpOfTitle: '원본 기사' }]);
    expect(p).toContain('Follow-up to our published article: "원본 기사"');
  });

  it('follow-up 이 아니면 그 줄이 없다', () => {
    expect(buildScoringPrompt([topic('신규')])).not.toContain('Follow-up');
  });

  it('긴 설명을 400자로 자른다', () => {
    const p = buildScoringPrompt([
      { title: 'T', items: [{ title: 'T', description: 'y'.repeat(900) }] },
    ]);
    expect(p).toContain('y'.repeat(400));
    expect(p).not.toContain('y'.repeat(401));
  });
});
