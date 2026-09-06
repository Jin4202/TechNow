import { describe, expect, it } from 'vitest';

import { publishMonthRange } from '@/db/published-articles';

/**
 * 아카이브의 월 경계 (로드맵 7.8).
 *
 * 발행이 07:00 America/Los_Angeles 로 돌기 때문에(D-04) 독자가 보는 "9월 기사" 도
 * PT 기준이다. UTC 로 자르면 PT 로 8월 31일 저녁에 발행된 기사가 9월로 넘어간다.
 *
 * PT 는 서머타임에 따라 UTC-7 / UTC-8 을 오간다. 오프셋을 상수로 박으면
 * 3월과 11월이 한 시간씩 틀린다 — 그것을 여기서 고정한다.
 */

describe('publishMonthRange', () => {
  it('여름(PDT, UTC-7)은 07:00Z 에 시작한다', () => {
    expect(publishMonthRange('2026-09')).toEqual({
      from: '2026-09-01T07:00:00.000Z',
      to: '2026-10-01T07:00:00.000Z',
    });
  });

  it('겨울(PST, UTC-8)은 08:00Z 에 시작한다', () => {
    expect(publishMonthRange('2026-01')).toEqual({
      from: '2026-01-01T08:00:00.000Z',
      to: '2026-02-01T08:00:00.000Z',
    });
  });

  it('서머타임이 시작되는 달의 1일은 아직 PST 다', () => {
    // 2026년 서머타임 시작은 3월 8일. 3월 1일은 UTC-8
    const range = publishMonthRange('2026-03')!;
    expect(range.from).toBe('2026-03-01T08:00:00.000Z');
    // 4월 1일은 이미 PDT 라 07:00Z
    expect(range.to).toBe('2026-04-01T07:00:00.000Z');
  });

  it('서머타임이 끝나는 달의 1일은 아직 PDT 다', () => {
    // 2026년 서머타임 종료는 11월 1일 02:00. 그날 00:00 은 아직 UTC-7
    expect(publishMonthRange('2026-11')!.from).toBe('2026-11-01T07:00:00.000Z');
  });

  it('12월의 다음 달은 이듬해 1월이다', () => {
    expect(publishMonthRange('2026-12')!.to).toBe('2027-01-01T08:00:00.000Z');
  });

  it('형식이 아니면 null', () => {
    // 아카이브 페이지가 이 값으로 404 를 낸다. 조용히 빈 목록을 보여주면
    // 그달에 기사가 없는 것처럼 읽힌다
    for (const bad of ['2026-13', '2026-00', 'abc', '', '2026', '2026-9', '2026-09-01']) {
      expect(publishMonthRange(bad), bad).toBeNull();
    }
  });
});
