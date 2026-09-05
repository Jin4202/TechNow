import {
  blockedDomains,
  tier1Domains,
  tier1Suffixes,
  tier2Domains,
} from '@/config/source-tiers';

/**
 * 검색 결과 URL 을 tier 로 판정한다 (로드맵 3.3).
 *
 * 순수 함수다. 프롬프트가 아니라 코드가 판정해야 재현 가능하다.
 *
 * 매칭은 호스트 단위다. `nature.com` 은 `www.nature.com` 과 `blogs.nature.com` 에
 * 걸리지만 `notnature.com` 에는 걸리지 않는다.
 */

export type SourceTier = 1 | 2;

export type TierVerdict =
  | { tier: SourceTier; matched: string }
  | { tier: null; reason: 'blocked' | 'unknown' | 'invalid-url'; matched?: string };

/** www 를 떼고 소문자로. 판정의 기준 형태 */
export function normalizeHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** host 가 domain 이거나 그 서브도메인인가 */
function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function findMatch(host: string, domains: readonly string[]): string | undefined {
  return domains.find((domain) => hostMatches(host, domain));
}

export function classifySource(rawUrl: string): TierVerdict {
  const host = normalizeHost(rawUrl);
  if (!host) return { tier: null, reason: 'invalid-url' };

  // 차단이 가장 먼저다. 애그리게이터가 대학 도메인에 얹혀 있을 수 있다
  const blocked = findMatch(host, blockedDomains);
  if (blocked) return { tier: null, reason: 'blocked', matched: blocked };

  const tier1 = findMatch(host, tier1Domains);
  if (tier1) return { tier: 1, matched: tier1 };

  const suffix = tier1Suffixes.find((s) => host.endsWith(s));
  if (suffix) return { tier: 1, matched: suffix };

  const tier2 = findMatch(host, tier2Domains);
  if (tier2) return { tier: 2, matched: tier2 };

  // 모르는 도메인은 쓰지 않는다. 목록에 없다는 건 검증되지 않았다는 뜻이다
  return { tier: null, reason: 'unknown' };
}

export interface FilteredSource {
  url: string;
  tier: SourceTier;
  matched: string;
}

export interface FilterSourcesResult {
  accepted: FilteredSource[];
  rejected: { url: string; reason: string }[];
}

/**
 * 검색 결과를 걸러 tier 순으로 정렬한다.
 *
 * Tier 1 을 앞에 둔다 — 기사에 Tier 1 이 최소 하나는 있어야 하고(3.10),
 * fetch 는 순위 순으로 진행하다 5개에서 멈추기 때문이다.
 */
export function filterSources(urls: readonly string[]): FilterSourcesResult {
  const accepted: FilteredSource[] = [];
  const rejected: { url: string; reason: string }[] = [];
  const seenHosts = new Set<string>();

  for (const url of urls) {
    const verdict = classifySource(url);

    if (verdict.tier === null) {
      rejected.push({ url, reason: verdict.reason });
      continue;
    }

    // 같은 매체에서 두 건을 쓰면 출처를 늘린 게 아니라 같은 얘기를 두 번 세는 것이다
    const host = normalizeHost(url)!;
    if (seenHosts.has(host)) {
      rejected.push({ url, reason: 'duplicate-host' });
      continue;
    }
    seenHosts.add(host);

    accepted.push({ url, tier: verdict.tier, matched: verdict.matched });
  }

  // Tier 1 먼저. 같은 tier 안에서는 검색 순위를 유지한다
  const order = new Map(accepted.map((s, i) => [s.url, i]));
  accepted.sort((a, b) => a.tier - b.tier || order.get(a.url)! - order.get(b.url)!);

  return { accepted, rejected };
}
