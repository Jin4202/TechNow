import { FILTER_RULES, MIN_TITLE_LENGTH } from '@/config/filters';

import type { FeedItem } from './parse-feed';

/**
 * LLM 을 부르기 전에 코드로 거르는 단계 (로드맵 2.1).
 *
 * 순수 함수다. 탈락시킨 항목과 사유를 함께 돌려주므로 캘리브레이션(2.8)에서
 * "무엇을 왜 버렸는지" 확인할 수 있다.
 *
 * 제목만 본다. 설명은 매체마다 길이와 형식이 제각각이라 신호가 되지 못한다.
 */

export interface FilterReject {
  item: FeedItem;
  reason: string;
}

export interface FilterResult {
  kept: FeedItem[];
  rejected: FilterReject[];
}

/** 걸리면 사유, 통과하면 null */
export function rejectReason(item: FeedItem): string | null {
  const title = item.title.trim();

  if (title.length < MIN_TITLE_LENGTH) return 'too-short';

  for (const rule of FILTER_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(title))) return rule.name;
  }

  return null;
}

export function applyCheapFilters(items: readonly FeedItem[]): FilterResult {
  const kept: FeedItem[] = [];
  const rejected: FilterReject[] = [];

  for (const item of items) {
    const reason = rejectReason(item);
    if (reason) rejected.push({ item, reason });
    else kept.push(item);
  }

  return { kept, rejected };
}

/** 로그용 사유별 집계 */
export function summarizeRejections(rejected: readonly FilterReject[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rejected) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  return counts;
}
