import { USER_AGENT } from '@/config/http';

/**
 * robots.txt 확인 (CLAUDE.md §2.8).
 *
 * 완전한 구현은 아니다. User-agent 그룹과 Disallow/Allow 접두 규칙만 본다.
 * 우리가 하는 일(공개 기사 페이지 몇 개 읽기)에는 이걸로 충분하고,
 * 애매하면 **가져오지 않는 쪽**으로 판단한다.
 */

export interface RobotsRules {
  /** 접두 일치로 금지되는 경로들 */
  disallow: string[];
  /** disallow 보다 우선하는 허용 경로들 */
  allow: string[];
}

/** UA 토큰. 매칭은 소문자 접두로 한다 */
const UA_TOKEN = USER_AGENT.split('/')[0]!.toLowerCase();

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [] };

  // 우리 UA 를 지목한 그룹이 있으면 그것만, 없으면 * 그룹을 쓴다
  let currentAgents: string[] = [];
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!lastWasAgent) {
        currentAgents = [];
        current = { agents: currentAgents, allow: [], disallow: [] };
        groups.push(current);
      }
      currentAgents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) continue;
    if (field === 'disallow') current.disallow.push(value);
    else if (field === 'allow') current.allow.push(value);
  }

  const specific = groups.find((g) => g.agents.some((a) => UA_TOKEN.startsWith(a) && a !== '*'));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const chosen = specific ?? wildcard;

  if (chosen) {
    // 빈 Disallow 는 "전부 허용" 이라는 뜻이다. 규칙으로 넣지 않는다
    rules.disallow = chosen.disallow.filter((p) => p !== '');
    rules.allow = chosen.allow.filter((p) => p !== '');
  }

  return rules;
}

/** 더 긴 규칙이 이긴다. 같으면 Allow 가 이긴다 (표준 관행) */
export function isAllowed(rules: RobotsRules, pathname: string): boolean {
  const longest = (patterns: string[]) =>
    patterns.filter((p) => pathname.startsWith(p)).reduce((max, p) => Math.max(max, p.length), -1);

  const disallowed = longest(rules.disallow);
  if (disallowed === -1) return true;

  return longest(rules.allow) >= disallowed;
}
