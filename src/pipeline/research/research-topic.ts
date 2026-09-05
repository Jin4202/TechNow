import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { readUsage, ZERO_USAGE, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { budget } from '@/config/budget';
import { models } from '@/config/models';
import { buildQueryPrompt, QUERY_SYSTEM, QueryPlanSchema } from '@/prompts/generate-queries';

import { fetchPage, type FetchContext } from './fetch-page';
import { filterSources, type SourceTier } from './source-tier';

import type { BraveClient } from '@/clients/brave';

/**
 * 한 토픽의 출처를 모은다 (로드맵 3.5).
 *
 * 쿼리 생성 → 검색 → tier 필터 → 순위 순 fetch → 5개에서 중단.
 *
 * 상한은 프롬프트가 아니라 여기서 카운터로 강제한다 (CLAUDE.md §2.6):
 * 검색 3회, 페이지 fetch 10회.
 */

export interface CollectedSource {
  url: string;
  title: string | null;
  publisher: string | null;
  tier: SourceTier;
  text: string;
}

export type ResearchSkipReason =
  /** 검색 결과 중 쓸 만한 도메인이 없었다 */
  | 'no-usable-candidates'
  /** fetch 를 다 해봤지만 최소 출처 수에 못 미쳤다 */
  | 'too-few-sources';

export interface ResearchResult {
  sources: CollectedSource[];
  /** 최소 출처 수를 못 채우면 이유가 들어온다. 채웠으면 null */
  skipped: ResearchSkipReason | null;
  queries: string[];
  searchCalls: number;
  pagesFetched: number;
  usage: TokenUsage;
  /** 왜 버렸는지. 로그와 캘리브레이션용 */
  rejections: { url: string; reason: string }[];
  /**
   * tier 필터를 통과한 Tier 1 후보 수 (fetch 성공 여부와 무관).
   *
   * 3.10 의 "해당 토픽에 Tier 1 이 존재한다면 최소 하나는 Tier 1" 규칙을
   * 판정하려면 애초에 Tier 1 후보가 있었는지 알아야 한다
   */
  tier1CandidatesSeen: number;
}

export interface ResearchTopicInput {
  title: string;
  items: { title: string; description: string }[];
}

/** 쿼리 생성이 실패해도 조사를 포기하지 않는다. 토픽 제목이 그럭저럭 쓸 만하다 */
function fallbackQueries(title: string): string[] {
  return [title.slice(0, 120)];
}

export async function generateQueries(
  claude: AnthropicClient,
  topic: ResearchTopicInput,
): Promise<{ queries: string[]; usage: TokenUsage }> {
  try {
    const response = await claude.messages.parse({
      model: models.generateQueries,
      max_tokens: 1000,
      system: QUERY_SYSTEM,
      messages: [
        { role: 'user', content: buildQueryPrompt({ topicTitle: topic.title, items: topic.items }) },
      ],
      output_config: { format: zodOutputFormat(QueryPlanSchema) },
    });

    const queries = (response.parsed_output?.queries ?? [])
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, budget.searchCallsPerTopic);

    return {
      queries: queries.length > 0 ? queries : fallbackQueries(topic.title),
      usage: readUsage(response.usage),
    };
  } catch {
    return { queries: fallbackQueries(topic.title), usage: ZERO_USAGE };
  }
}

export async function researchTopic(
  claude: AnthropicClient,
  brave: BraveClient,
  fetchContext: FetchContext,
  topic: ResearchTopicInput,
): Promise<ResearchResult> {
  const { queries, usage } = await generateQueries(claude, topic);
  const rejections: { url: string; reason: string }[] = [];

  // ── 검색 (상한: searchCallsPerTopic) ──────────────────────
  const urls: string[] = [];
  let searchCalls = 0;

  for (const query of queries.slice(0, budget.searchCallsPerTopic)) {
    try {
      const results = await brave.search(query);
      searchCalls += 1;
      for (const result of results) urls.push(result.url);
    } catch (error) {
      // 쿼리 하나가 실패해도 나머지로 진행한다
      rejections.push({
        url: `query:${query}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── tier 필터 ─────────────────────────────────────────────
  // 같은 URL 이 여러 쿼리에서 나올 수 있다
  const { accepted, rejected } = filterSources([...new Set(urls)]);
  rejections.push(...rejected);

  const tier1CandidatesSeen = accepted.filter((c) => c.tier === 1).length;

  if (accepted.length === 0) {
    return {
      sources: [],
      skipped: 'no-usable-candidates',
      queries,
      searchCalls,
      pagesFetched: 0,
      usage,
      rejections,
      tier1CandidatesSeen: 0,
    };
  }

  // ── fetch (상한: pagesPerTopic, 5개에서 중단) ─────────────
  const sources: CollectedSource[] = [];
  let pagesFetched = 0;

  for (const candidate of accepted) {
    if (sources.length >= budget.maxSources) break;
    if (pagesFetched >= budget.pagesPerTopic) break;

    const page = await fetchPage(fetchContext, candidate.url);
    pagesFetched += 1;

    if (!page.ok) {
      rejections.push({ url: candidate.url, reason: page.reason });
      continue;
    }

    // 협찬 기사는 출처가 될 수 없다 (기획서 §2.2 의 제외 목록)
    if (page.sponsored) {
      rejections.push({ url: candidate.url, reason: 'sponsored' });
      continue;
    }

    sources.push({
      url: page.url,
      title: page.title,
      publisher: page.siteName,
      tier: candidate.tier,
      text: page.text,
    });
  }

  return {
    sources,
    skipped: sources.length < budget.minSources ? 'too-few-sources' : null,
    queries,
    searchCalls,
    pagesFetched,
    usage,
    rejections,
    tier1CandidatesSeen,
  };
}
