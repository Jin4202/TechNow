import { describe, expect, it } from 'vitest';

import { monthRange, previousMonthStart } from '@/db/monthly-scraps';

/**
 * 월간 집계의 날짜 경계 (로드맵 6.3).
 *
 * 경계를 틀리면 조용히 틀린다 — 요약은 나오는데 마지막 날 스크랩이 빠져 있다.
 * 그래서 여기를 고정한다.
 */

describe('monthRange', () => {
  it('그 달 1일부터 다음 달 1일 직전까지', () => {
    const { from, to } = monthRange('2026-09-01');

    expect(from).toBe('2026-09-01T00:00:00.000Z');
    expect(to).toBe('2026-10-01T00:00:00.000Z');
  });

  it('12월이면 다음 해 1월로 넘어간다', () => {
    const { to } = monthRange('2026-12-01');
    expect(to).toBe('2027-01-01T00:00:00.000Z');
  });

  it('2월과 윤년을 따로 계산하지 않는다', () => {
    // "말일" 을 구하지 않기 때문에 월 길이와 윤년이 끼어들 자리가 없다
    expect(monthRange('2028-02-01').to).toBe('2028-03-01T00:00:00.000Z');
    expect(monthRange('2027-02-01').to).toBe('2027-03-01T00:00:00.000Z');
  });

  it('31일에서 시작해도 월을 건너뛰지 않는다', () => {
    // Date.setUTCMonth 는 1월 31일 + 1개월을 3월 3일로 만든다.
    // 1일에서만 시작하므로 이 함정에 걸리지 않는다는 것을 고정해 둔다
    expect(monthRange('2026-01-01').to).toBe('2026-02-01T00:00:00.000Z');
  });

  it('형식이 잘못되면 던진다', () => {
    expect(() => monthRange('2026-13')).toThrow(/날짜 형식/);
  });
});

describe('previousMonthStart', () => {
  it('매월 1일 스케줄이 지난달을 가리킨다', () => {
    expect(previousMonthStart(new Date('2026-10-01T09:00:00Z'))).toBe('2026-09-01');
  });

  it('1월 1일이면 작년 12월이다', () => {
    expect(previousMonthStart(new Date('2027-01-01T09:00:00Z'))).toBe('2026-12-01');
  });

  it('달 중간에 수동 실행해도 지난달이다', () => {
    // 대시보드에서 손으로 돌려보는 경우 (기획서 §11)
    expect(previousMonthStart(new Date('2026-10-17T22:30:00Z'))).toBe('2026-09-01');
  });
});
