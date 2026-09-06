import { describe, expect, it } from 'vitest';

import { listScraps, toggleScrap } from '@/db/scraps';

import type { Database } from '@/db/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 스크랩 토글 (로드맵 6.1).
 *
 * 확인하는 것은 **한 버튼이 두 방향을 어떻게 가르는가** 다.
 * 상태를 먼저 읽고 쓰면 그 사이에 다른 탭이 바꿀 수 있으므로,
 * 넣어 보고 유니크 제약에 걸리면 지우는 방식을 쓴다.
 */

interface Options {
  user: { id: string } | null;
  insertError?: { code: string; message: string } | null;
  deleteError?: { code: string; message: string } | null;
}

function fakeDb(options: Options) {
  const inserted: Record<string, unknown>[] = [];
  const deleted: string[] = [];

  const db = {
    auth: { getUser: async () => ({ data: { user: options.user } }) },
    from() {
      return {
        insert: async (row: Record<string, unknown>) => {
          inserted.push(row);
          return { error: options.insertError ?? null };
        },
        delete: () => ({
          eq: (_c: string, value: string) => ({
            eq: async (_c2: string, articleId: string) => {
              deleted.push(`${value}:${articleId}`);
              return { error: options.deleteError ?? null };
            },
          }),
        }),
      };
    },
  };

  return { db: db as unknown as SupabaseClient<Database>, inserted, deleted };
}

const ARTICLE = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('toggleScrap', () => {
  it('처음 누르면 행이 생긴다', async () => {
    const { db, inserted } = fakeDb({ user: { id: 'user-1' } });

    expect(await toggleScrap(db, ARTICLE)).toBe('scrapped');
    expect(inserted[0]).toEqual({ user_id: 'user-1', article_id: ARTICLE });
  });

  it('이미 스크랩했으면 해제한다', async () => {
    // 유니크 제약 위반이 곧 "이미 담았다" 는 뜻이다
    const { db, deleted } = fakeDb({
      user: { id: 'user-1' },
      insertError: { code: '23505', message: 'duplicate key' },
    });

    expect(await toggleScrap(db, ARTICLE)).toBe('unscrapped');
    expect(deleted).toEqual([`user-1:${ARTICLE}`]);
  });

  it('로그인하지 않았으면 던지지 않고 알린다', async () => {
    // 예외로 만들면 기사 화면이 통째로 에러 경계로 넘어간다.
    // 버튼이 로그인 안내로 바뀌면 될 일이다
    const { db, inserted } = fakeDb({ user: null });

    expect(await toggleScrap(db, ARTICLE)).toBe('not-logged-in');
    expect(inserted).toEqual([]);
  });

  it('없는 기사면 not-found 다', async () => {
    // 발행 전 기사를 id 로 찔러본 경우도 외래키에서 걸린다
    const { db } = fakeDb({
      user: { id: 'user-1' },
      insertError: { code: '23503', message: 'foreign key violation' },
    });

    expect(await toggleScrap(db, ARTICLE)).toBe('not-found');
  });

  it('알 수 없는 오류는 삼키지 않는다', async () => {
    // 조용히 실패하면 사용자는 담긴 줄 알고, 폴더에서 사라진 이유를 모른다
    const { db } = fakeDb({
      user: { id: 'user-1' },
      insertError: { code: '42501', message: 'permission denied' },
    });

    await expect(toggleScrap(db, ARTICLE)).rejects.toThrow(/스크랩 실패/);
  });

  it('해제 실패도 삼키지 않는다', async () => {
    const { db } = fakeDb({
      user: { id: 'user-1' },
      insertError: { code: '23505', message: 'duplicate key' },
      deleteError: { code: '42501', message: 'permission denied' },
    });

    await expect(toggleScrap(db, ARTICLE)).rejects.toThrow(/스크랩 해제 실패/);
  });
});

describe('listScraps', () => {
  /** scraps → articles → article_translations 를 한 번에 가져오는 조인 결과 */
  function fakeList(rows: unknown[]) {
    const filters: string[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: (column: string, value: string) => {
            filters.push(`${column}=${value}`);
            return {
              order: () => ({
                limit: async () => ({ data: rows, error: null }),
              }),
            };
          },
        }),
      }),
    };
    return { db: db as unknown as SupabaseClient<Database>, filters };
  }

  const row = {
    scraped_at: '2026-09-05T00:00:00Z',
    articles: {
      id: 'article-1',
      slug: 'a-slug',
      category: 'space-astronomy',
      title: 'Roman Space Telescope launches',
      one_line_summary: 'It surveys far more sky.',
      cover_image_url: 'https://storage.test/covers/article-1.jpg',
      published_at: '2026-09-04T00:00:00Z',
      status: 'published',
      article_translations: [
        { locale: 'ko', title: '로만 우주망원경 발사', one_line_summary: '더 넓은 하늘을 훑습니다.' },
      ],
    },
  };

  it('발행된 기사만 가져온다', async () => {
    // 내려간 기사(unpublished)가 폴더에 남아 있으면 링크가 404 로 간다
    const { db, filters } = fakeList([row]);
    await listScraps(db, 'en');

    expect(filters).toContain('articles.status=published');
  });

  it('해당 언어의 번역본으로 바꿔준다', async () => {
    const { db } = fakeList([row]);
    const [article] = await listScraps(db, 'ko');

    expect(article!.title).toBe('로만 우주망원경 발사');
    expect(article!.scrappedAt).toBe('2026-09-05T00:00:00Z');
  });

  it('번역이 없으면 영문으로 보여준다 — 폴더에서 사라지게 두지 않는다', async () => {
    // 목록(D-35)과 다른 규칙이다. 사용자가 직접 담은 기사가 말없이 없어지면
    // 왜 없어졌는지 알 방법이 없다
    const noTranslation = {
      ...row,
      articles: { ...row.articles, article_translations: [] },
    };
    const { db } = fakeList([noTranslation]);
    const [article] = await listScraps(db, 'ko');

    expect(article!.title).toBe('Roman Space Telescope launches');
  });
});
