import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnthropicClient } from '@/clients/anthropic';
import type { FalClient } from '@/clients/fal';
import type { ServiceClient } from '@/db/supabase/service';

/**
 * 커버 이미지의 파이프라인 편입 (로드맵 5.5).
 *
 * 커버가 필수 자산이 된 상태를 흉내낸다 (`required-assets` 를 mock).
 * 5.4 에서 config 를 실제로 바꾸기 전에 이 경로가 도는지 여기서 고정한다.
 *
 * 세 단계가 한 묶음이다: 장면 선택(D-38) → 생성 → 우리 Storage 로 업로드(5.3).
 * 어디서 끊겨도 자산이 없는 것이므로 묶어서 재시도한다.
 */

vi.mock('@/config/required-assets', () => ({
  requiredAssets: ['english_body', 'cover_image'],
  ALL_ASSETS: ['english_body', 'korean_translation', 'cover_image'],
  STYLE_GUIDE_VERSION: 'test',
}));

const { fillAssets } = await import('@/pipeline/fill-assets');

const article = {
  id: 'article-1',
  title: 'Underground detector records a flash it cannot explain',
  oneLineSummary: 'The odds that background noise produced the signal are one in two hundred.',
  sections: [
    {
      heading: 'What the detector saw',
      paragraphs: ['The experiment recorded a single flash.'],
      sources: [1, 2],
    },
  ],
  locales: ['ko'],
  coverImageUrl: null as string | null,
};

const concept = {
  mode: 'subject',
  scene: 'A drum-shaped tank deep underground with one faint flash inside.',
  rationale: 'The article is about a specific instrument.',
};

function fakeClaude(output: unknown = concept) {
  const calls: string[] = [];
  const claude = {
    messages: {
      parse: async ({ messages }: { messages: { content: string }[] }) => {
        calls.push(messages[0]!.content);
        return {
          parsed_output: output,
          usage: {
            input_tokens: 400,
            output_tokens: 90,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  };
  return { claude: claude as unknown as AnthropicClient, calls };
}

function fakeFal(behaviour: 'ok' | 'fail' = 'ok') {
  const prompts: string[] = [];
  const fal = {
    imageCount: 0,
    generate: async (_model: string, prompt: string) => {
      prompts.push(prompt);
      if (behaviour === 'fail') throw new Error('HTTP 500 fal is down');
      return {
        url: 'https://fal.test/image.jpg',
        width: 1024,
        height: 576,
        contentType: 'image/jpeg',
      };
    },
  };
  return { fal: fal as unknown as FalClient, prompts };
}

/** articles 업데이트와 Storage 업로드를 받는 가짜 DB */
function fakeDb() {
  const saved: { column: string; value: unknown }[] = [];
  const promoted: string[] = [];
  const uploads: string[] = [];

  const db = {
    from() {
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            if ('cover_image_url' in patch) {
              // saveCoverImageUrl: update().eq().neq()
              return {
                neq: async () => {
                  saved.push({ column: 'cover_image_url', value: patch.cover_image_url });
                  return { error: null };
                },
              };
            }
            // markArticleReady: update().eq().eq().select()
            return {
              eq: () => ({
                select: async () => {
                  if (patch.status === 'ready') promoted.push(id);
                  return { data: [{ id }], error: null };
                },
              }),
            };
          },
        }),
      };
    },
    storage: {
      from() {
        return {
          upload: async (path: string) => {
            uploads.push(path);
            return { error: null };
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://storage.test/covers/${path}` },
          }),
        };
      },
    },
  };

  return { db: db as unknown as ServiceClient, saved, promoted, uploads };
}

/** fal 이 준 URL 을 내려받는 fetch */
const imageFetch = (async () =>
  new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
    headers: { 'content-type': 'image/jpeg' },
  })) as unknown as typeof fetch;

beforeEach(() => {
  vi.stubGlobal('fetch', imageFetch);
});

describe('fillAssets — 커버 이미지 (5.5)', () => {
  it('장면을 고르고, 그리고, 우리 Storage 에 올리고, 기사에 붙인다', async () => {
    const { db, saved, promoted, uploads } = fakeDb();
    const { claude } = fakeClaude();
    const { fal, prompts } = fakeFal();

    const result = await fillAssets(db, claude, fal, article);

    expect(result.filled).toEqual(['cover_image']);
    expect(result.ready).toBe(true);
    expect(result.imagesGenerated).toBe(1);

    // 고른 장면이 그림 프롬프트에 들어간다 (D-38)
    expect(prompts[0]).toContain('drum-shaped tank');
    // 파일 이름은 기사 uuid 다 (5.3)
    expect(uploads[0]).toBe('article-1.jpg');
    // fal 의 URL 이 아니라 우리 Storage URL 을 저장한다
    expect(saved[0]?.value).toContain('storage.test');
    expect(promoted).toEqual(['article-1']);
  });

  it('생성이 실패하면 발행 대기로 올리지 않고, 런 안에서 1회 재시도한다', async () => {
    const { db, promoted, saved } = fakeDb();
    const { claude, calls } = fakeClaude();
    const { fal, prompts } = fakeFal('fail');

    const result = await fillAssets(db, claude, fal, article);

    expect(result.ready, '커버 없는 기사는 그날 아침 발행에서 빠진다').toBe(false);
    expect(result.failures[0]).toMatchObject({ asset: 'cover_image', failure: 'generate-failed' });
    expect(saved).toEqual([]);
    expect(promoted).toEqual([]);

    // 기획서 §2.4 — 같은 런에서 1회 재시도
    expect(prompts).toHaveLength(2);
    expect(calls).toHaveLength(2);
    // 실패한 시도는 이미지 수에 들어가지 않는다. 청구되지 않았다
    expect(result.imagesGenerated).toBe(0);
  });

  it('장면을 못 고르면 그리지 않는다', async () => {
    // 빈 장면을 이미지 모델에 넘기면 알아서 지어낸다 — 그게 D-37 의 색면이었다
    const { db } = fakeDb();
    const { claude } = fakeClaude({ ...concept, scene: '' });
    const { fal, prompts } = fakeFal();

    const result = await fillAssets(db, claude, fal, article);

    expect(prompts).toHaveLength(0);
    expect(result.failures[0]?.failure).toContain('concept');
  });

  it('이미 커버가 있으면 다시 만들지 않는다', async () => {
    // 스윕이 같은 기사를 다시 만나는 경우 (D-33). 자산이 있으면 돈을 또 쓰지 않는다
    const { db, promoted } = fakeDb();
    const { claude, calls } = fakeClaude();
    const { fal, prompts } = fakeFal();

    const result = await fillAssets(db, claude, fal, {
      ...article,
      coverImageUrl: 'https://storage.test/covers/article-1.jpg',
    });

    expect(calls).toHaveLength(0);
    expect(prompts).toHaveLength(0);
    expect(result.ready).toBe(true);
    expect(promoted).toEqual(['article-1']);
  });
});
