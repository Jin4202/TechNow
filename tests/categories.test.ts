import { describe, expect, it } from 'vitest';

import { CATEGORIES, CATEGORY_VALUES, categoryLabel, getCategory, isCategory } from '@/config/categories';

describe('categories', () => {
  it('정확히 7종이다 (기획서 §0에서 고정)', () => {
    expect(CATEGORIES).toHaveLength(7);
  });

  it('value 가 중복되지 않는다', () => {
    expect(new Set(CATEGORY_VALUES).size).toBe(CATEGORIES.length);
  });

  it('value 는 URL과 DB enum에 그대로 쓸 수 있는 kebab-case 다', () => {
    for (const c of CATEGORIES) {
      expect(c.value, c.value).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('모든 카테고리에 영문·한국어 이름과 설명이 있다', () => {
    for (const c of CATEGORIES) {
      expect(c.en.length, c.value).toBeGreaterThan(0);
      expect(c.ko.length, c.value).toBeGreaterThan(0);
      expect(c.description.length, c.value).toBeGreaterThan(20);
    }
  });

  it('locale 별 표시 이름을 돌려준다', () => {
    expect(categoryLabel('ai-computing', 'en')).toBe('AI & Computing');
    expect(categoryLabel('ai-computing', 'ko')).toBe('AI·컴퓨팅');
  });

  it('알 수 없는 값은 거부한다', () => {
    expect(isCategory('ai-computing')).toBe(true);
    expect(isCategory('quantum-cooking')).toBe(false);
    // @ts-expect-error 런타임 방어 확인
    expect(() => getCategory('quantum-cooking')).toThrow();
  });
});

describe('DB enum 과의 동기화', () => {
  it('src/config/categories.ts 와 DB category enum 이 정확히 일치한다', async () => {
    // config 에만 추가하고 마이그레이션을 빠뜨리면 (또는 그 반대) 여기서 잡힌다.
    // types.ts 는 `pnpm db:types` 로 로컬 스키마에서 생성한다.
    const { Constants } = await import('@/db/types');
    const dbValues = [...Constants.public.Enums.category].sort();
    expect(dbValues).toEqual([...CATEGORY_VALUES].sort());
  });
});
