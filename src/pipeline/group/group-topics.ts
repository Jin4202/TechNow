import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { readUsage, ZERO_USAGE, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { models } from '@/config/models';
import {
  buildGroupingPrompt,
  GROUPING_SYSTEM,
  GroupingResultSchema,
  type GroupedTopic,
} from '@/prompts/group-topics';

import type { FeedItem } from '@/pipeline/discover/parse-feed';

/**
 * 같은 사건을 다룬 항목들을 토픽으로 묶는다 (로드맵 2.2, 2.3).
 *
 * 실패하면 던지지 않고 폴백한다 — 항목 하나를 토픽 하나로 본다 (기획서 §2.1).
 * 그룹핑이 안 됐다고 그날 런 전체를 버리는 것보다, 중복이 좀 있더라도
 * 채점 단계로 넘기는 편이 낫다.
 */

export interface Topic {
  title: string;
  items: FeedItem[];
  /** 후속인 경우 원본 기사 id */
  followUpOfArticleId: string | null;
}

export interface RecentArticle {
  id: string;
  title: string;
}

export interface GroupTopicsResult {
  topics: Topic[];
  usage: TokenUsage;
  /** 폴백으로 처리했는지. 로그와 캘리브레이션에 쓴다 */
  usedFallback: boolean;
  fallbackReason?: string;
}

/** 항목 하나당 토픽 하나 (그룹핑 실패 시) */
export function fallbackTopics(items: readonly FeedItem[]): Topic[] {
  return items.map((item) => ({
    title: item.title,
    items: [item],
    followUpOfArticleId: null,
  }));
}

/**
 * 모델 출력을 우리 타입으로 옮긴다.
 *
 * 모델이 번호를 빠뜨리거나 중복해서 낼 수 있으므로 방어한다.
 * 어느 토픽에도 못 들어간 항목은 단독 토픽으로 살린다 — 조용히 버리면
 * 그 기사는 영영 후보가 되지 않는다.
 */
export function assembleTopics(
  raw: readonly GroupedTopic[],
  items: readonly FeedItem[],
  recent: readonly RecentArticle[],
): Topic[] {
  const used = new Set<number>();
  const topics: Topic[] = [];

  for (const group of raw) {
    const members: FeedItem[] = [];
    for (const number of group.itemNumbers) {
      const index = number - 1;
      const item = items[index];
      if (!item || used.has(index)) continue;
      used.add(index);
      members.push(item);
    }
    if (members.length === 0) continue;

    const followUp =
      group.followUpOf === null ? null : (recent[group.followUpOf - 1]?.id ?? null);

    topics.push({
      title: group.title.trim() || members[0]!.title,
      items: members,
      followUpOfArticleId: followUp,
    });
  }

  // 누락된 항목 구제
  items.forEach((item, index) => {
    if (!used.has(index)) {
      topics.push({ title: item.title, items: [item], followUpOfArticleId: null });
    }
  });

  return topics;
}

export async function groupTopics(
  client: AnthropicClient,
  items: readonly FeedItem[],
  recent: readonly RecentArticle[],
): Promise<GroupTopicsResult> {
  if (items.length === 0) {
    return { topics: [], usage: ZERO_USAGE, usedFallback: false };
  }

  try {
    const response = await client.messages.parse({
      model: models.group,
      max_tokens: 16000,
      system: GROUPING_SYSTEM,
      messages: [
        {
          role: 'user',
          content: buildGroupingPrompt({
            candidates: items.map((i) => ({ title: i.title, description: i.description })),
            recentTitles: recent.map((r) => r.title),
          }),
        },
      ],
      output_config: { format: zodOutputFormat(GroupingResultSchema) },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new Error('구조화 출력 파싱 실패');

    return {
      topics: assembleTopics(parsed.topics, items, recent),
      usage: readUsage(response.usage),
      usedFallback: false,
    };
  } catch (error) {
    // 폴백: 항목 하나 = 토픽 하나 (기획서 §2.1)
    return {
      topics: fallbackTopics(items),
      usage: ZERO_USAGE,
      usedFallback: true,
      fallbackReason: error instanceof Error ? error.message : String(error),
    };
  }
}
