import { afterAll, describe, expect, it } from 'vitest';

import { createServiceClient } from '@/db/supabase/service';
import { COVERS_BUCKET, uploadCover } from '@/pipeline/illustrate/upload-cover';

/**
 * 커버 업로드 라이브 확인 (로드맵 5.3). 실행: pnpm covers:upload
 *
 * 로컬 Supabase Storage 를 실제로 쓴다. **이미지 생성 API 는 부르지 않는다** —
 * 확인하려는 것은 "URL 을 받아 우리 Storage 에 올리고 공개 URL 을 돌려준다" 이고,
 * 그 URL 이 fal 에서 왔는지 여기서 만든 것인지는 상관이 없다. 비용 0.
 */

const db = createServiceClient();

/** 1×1 빨간 점 JPEG. 실제 이미지 바이트여야 버킷의 mime 검사를 통과한다 */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

const ARTICLE_ID = '00000000-0000-4000-8000-000000000123';

/** 원본 이미지를 주는 가짜 서버 대신, fetch 를 갈아끼운다 */
const fakeFetch = (async (url: string | URL) =>
  String(url) === 'https://example.test/cover.jpg'
    ? new Response(TINY_JPEG, { headers: { 'content-type': 'image/jpeg' } })
    : new Response('not found', { status: 404 })) as unknown as typeof fetch;

afterAll(async () => {
  await db.storage.from(COVERS_BUCKET).remove([`${ARTICLE_ID}.jpg`]);
});

describe('커버 업로드 (5.3)', () => {
  it('이미지를 Storage 에 올리고 공개 URL 을 돌려준다', async () => {
    const result = await uploadCover(db, ARTICLE_ID, 'https://example.test/cover.jpg', fakeFetch);

    expect(result.failure, result.detail ?? '').toBeNull();
    expect(result.bytes).toBeGreaterThan(0);

    // 파일 이름은 slug 가 아니라 기사 id 다. 버킷이 공개라 제목으로
    // 맞힐 수 있으면 안 된다 (CLAUDE.md §5 — Phase 7 까지 게이트 뒤)
    expect(result.publicUrl).toContain(`${ARTICLE_ID}.jpg`);
    console.log(`\n업로드: ${result.publicUrl} (${result.bytes} bytes)`);

    // 로그인하지 않은 브라우저가 실제로 받을 수 있어야 한다
    const served = await fetch(result.publicUrl!);
    expect(served.status, '공개 버킷인데 익명으로 못 읽는다').toBe(200);
    expect(served.headers.get('content-type')).toContain('image');
  });

  it('같은 기사를 다시 올려도 실패하지 않는다', async () => {
    // 자산 스윕이 같은 기사를 다시 만나는 경우 (4.4). upsert 가 아니면
    // 두 번째 시도가 영영 실패해 기사가 발행되지 못한다
    const result = await uploadCover(db, ARTICLE_ID, 'https://example.test/cover.jpg', fakeFetch);
    expect(result.failure).toBeNull();
  });

  it('원본을 못 가져오면 사유를 남긴다', async () => {
    const result = await uploadCover(db, ARTICLE_ID, 'https://example.test/missing.jpg', fakeFetch);

    expect(result.failure).toBe('download-failed');
    expect(result.publicUrl).toBeNull();
  });

  it('이미지가 아니면 올리지 않는다', async () => {
    const htmlFetch = (async () =>
      new Response('<html>error page</html>', {
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;

    const result = await uploadCover(db, ARTICLE_ID, 'https://example.test/x', htmlFetch);
    expect(result.failure).toBe('bad-image');
  });
});
