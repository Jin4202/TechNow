import type Anthropic from '@anthropic-ai/sdk';

/**
 * 출처 본문을 읽는 네 단계(작성·클레임추출·검증·재작성)의 공용 프롬프트 구조 (D-06).
 *
 * **프롬프트 캐시는 프리픽스 일치다.** 프리픽스에서 1바이트만 달라져도 그 뒤가
 * 전부 무효가 된다. 렌더 순서는 tools → system → messages 이므로:
 *
 *   system     네 단계가 **동일**한 문장을 쓴다
 *   messages[0].content[0]  출처 본문 블록 (여기에 cache_control)
 *   messages[0].content[1]  단계별 지시문 (여기서부터 달라진다)
 *
 * 단계별 지시문을 system 에 넣으면 프리픽스가 즉시 깨진다. 그래서 지시문은
 * 반드시 출처 블록 **뒤**에 온다.
 *
 * 이 구조를 우회해서 프롬프트를 만들지 말 것. 예산이 이 캐시 공유를 전제로 잡혀 있다.
 */

export interface PromptSource {
  /** article_sources.ordinal. 1부터 */
  ordinal: number;
  url: string;
  title: string | null;
  publisher: string | null;
  tier: 1 | 2;
  text: string;
}

/** 출처 하나가 프롬프트에서 차지하는 최대 길이. 앞부분에 핵심이 있다 */
const MAX_SOURCE_CHARS = 12_000;

/**
 * 네 단계가 공유하는 시스템 프롬프트.
 *
 * 여기에는 **단계와 무관하게 참인 것**만 넣는다. 단계별 지시는 지시문 쪽으로.
 */
export const GROUNDED_SYSTEM = `You work on a science and technology news site that publishes original articles built from primary sources.

Everything you write must be traceable to the source texts you are given. You have no other knowledge to draw on for facts: no numbers, names, dates, or causal claims from memory. If the sources do not say it, it does not go in.

Sources are numbered. When you refer to what a source supports, use its number.

Where sources disagree, say they disagree. Do not pick a side, and do not average them.
Where a source hedges ("preliminary", "in mice", "not yet peer reviewed"), carry the hedge through.`;

/**
 * 출처 본문 블록. **네 단계에서 글자 하나까지 같아야 한다.**
 *
 * 순서는 ordinal 오름차순으로 고정한다 — 입력 배열 순서에 맡기면
 * 단계마다 순서가 달라져 캐시가 깨진다.
 */
export function buildSourceBlock(sources: readonly PromptSource[]): string {
  const ordered = [...sources].sort((a, b) => a.ordinal - b.ordinal);

  const blocks = ordered.map((source) => {
    const header = [
      `[SOURCE ${source.ordinal}]`,
      `tier: ${source.tier}`,
      `url: ${source.url}`,
      source.title ? `title: ${source.title}` : null,
      source.publisher ? `publisher: ${source.publisher}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return `${header}\n\n${source.text.slice(0, MAX_SOURCE_CHARS).trim()}`;
  });

  return `--- SOURCE TEXTS ---\n\n${blocks.join('\n\n---\n\n')}\n\n--- END SOURCE TEXTS ---`;
}

/**
 * 캐시 가능한 출처 블록 + 단계별 지시문으로 메시지를 만든다.
 *
 * 주의: `output_config` 의 스키마가 단계마다 다르면 캐시 프리픽스가 깨질 수 있다.
 * 구조화 출력이 프롬프트 앞쪽에 도구 정의로 렌더되는지 아닌지는 문서로 확정하지
 * 못했다 — `usage.cache_read_input_tokens` 로 실측해서 판단한다 (3.8a).
 */
export function buildGroundedMessages(
  sourceBlock: string,
  instructions: string,
): Anthropic.MessageParam[] {
  return [
    {
      role: 'user',
      content: [
        // 캐시 경계. 이 앞은 네 단계가 동일하다
        { type: 'text', text: sourceBlock, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: instructions },
      ],
    },
  ];
}
