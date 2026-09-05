import { describe, expect, it } from 'vitest';

import { isAllowed, parseRobots } from '@/pipeline/research/robots';

describe('parseRobots', () => {
  it('* 그룹의 Disallow 를 읽는다', () => {
    const r = parseRobots('User-agent: *\nDisallow: /admin\nDisallow: /private');
    expect(r.disallow).toEqual(['/admin', '/private']);
  });

  it('빈 Disallow 는 전부 허용이므로 규칙이 아니다', () => {
    const r = parseRobots('User-agent: *\nDisallow:');
    expect(r.disallow).toEqual([]);
  });

  it('주석과 빈 줄을 무시한다', () => {
    const r = parseRobots('# 주석\n\nUser-agent: *\nDisallow: /x  # 뒤 주석\n');
    expect(r.disallow).toEqual(['/x']);
  });

  it('우리 UA 를 지목한 그룹이 * 보다 우선한다', () => {
    const r = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: TechNowBot\nDisallow: /admin',
    );
    expect(r.disallow).toEqual(['/admin']);
  });

  it('연속된 User-agent 줄은 한 그룹이다', () => {
    const r = parseRobots('User-agent: BadBot\nUser-agent: *\nDisallow: /shared');
    expect(r.disallow).toEqual(['/shared']);
  });

  it('다른 봇만 지목한 그룹은 우리와 무관하다', () => {
    const r = parseRobots('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin');
    expect(r.disallow).toEqual(['/admin']);
  });

  it('Allow 를 읽는다', () => {
    const r = parseRobots('User-agent: *\nDisallow: /news\nAllow: /news/public');
    expect(r.allow).toEqual(['/news/public']);
  });

  it('빈 robots.txt 는 제한 없음', () => {
    expect(parseRobots('')).toEqual({ disallow: [], allow: [] });
  });
});

describe('isAllowed', () => {
  it('규칙이 없으면 허용', () => {
    expect(isAllowed({ disallow: [], allow: [] }, '/anything')).toBe(true);
  });

  it('접두가 일치하면 금지', () => {
    expect(isAllowed({ disallow: ['/admin'], allow: [] }, '/admin/users')).toBe(false);
  });

  it('접두가 다르면 허용', () => {
    expect(isAllowed({ disallow: ['/admin'], allow: [] }, '/news/2026')).toBe(true);
  });

  it('더 긴 Allow 가 Disallow 를 이긴다', () => {
    const rules = { disallow: ['/news'], allow: ['/news/public'] };
    expect(isAllowed(rules, '/news/public/a')).toBe(true);
    expect(isAllowed(rules, '/news/private')).toBe(false);
  });

  it('전체 금지', () => {
    expect(isAllowed({ disallow: ['/'], allow: [] }, '/anything')).toBe(false);
  });
});
