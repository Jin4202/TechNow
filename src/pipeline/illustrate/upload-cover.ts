import type { ServiceClient } from '@/db/supabase/service';

/**
 * 커버 이미지를 Supabase Storage 에 올린다 (로드맵 5.3).
 *
 * fal 이 준 URL 을 그대로 기사에 저장하지 않는다. 그 URL 은 남의 서버에 있고
 * 언제 사라질지 모르며, 발행된 기사는 수정하지 않으므로(CLAUDE.md §2.2)
 * 이미지가 사라지면 고칠 방법이 없다. 우리 Storage 로 옮겨 놓는다.
 *
 * **파일 이름은 기사 id(uuid) 다.** 버킷이 공개라 slug 로 두면 제목을 아는 사람이
 * URL 을 맞힐 수 있다 — 사이트는 Phase 7 까지 게이트 뒤에 있다 (CLAUDE.md §5).
 */

export const COVERS_BUCKET = 'covers';

/** 내려받기 상한. 1024×576 jpeg 는 100KB 안팎이다 */
const MAX_BYTES = 5 * 1024 * 1024;

export type UploadFailure =
  /** 원본 URL 에서 못 가져옴 */
  | 'download-failed'
  /** 이미지가 아니거나 너무 큼 */
  | 'bad-image'
  /** Storage 업로드 실패 */
  | 'upload-failed';

export interface UploadResult {
  publicUrl: string | null;
  failure: UploadFailure | null;
  detail?: string;
  bytes: number;
}

export async function uploadCover(
  db: ServiceClient,
  articleId: string,
  imageUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadResult> {
  let bytes: Buffer;
  let contentType: string;

  try {
    const response = await fetchImpl(imageUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      return {
        publicUrl: null,
        failure: 'download-failed',
        detail: `HTTP ${response.status}`,
        bytes: 0,
      };
    }

    contentType = response.headers.get('content-type') ?? 'image/jpeg';
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return {
      publicUrl: null,
      failure: 'download-failed',
      detail: error instanceof Error ? error.message : String(error),
      bytes: 0,
    };
  }

  // 이미지가 아닌 것이 오면 버킷의 mime 제한에 걸린다. 그 전에 잡아서
  // 사유를 분명히 남긴다 — Storage 오류 메시지만으로는 원인을 알기 어렵다
  if (!contentType.startsWith('image/')) {
    return { publicUrl: null, failure: 'bad-image', detail: contentType, bytes: bytes.length };
  }

  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return {
      publicUrl: null,
      failure: 'bad-image',
      detail: `${bytes.length} bytes`,
      bytes: bytes.length,
    };
  }

  const path = `${articleId}.${extensionFor(contentType)}`;

  const { error } = await db.storage.from(COVERS_BUCKET).upload(path, bytes, {
    contentType,
    // 같은 기사를 재시도하는 경우가 있다. 두 번째 업로드가 실패하면
    // 자산이 영영 안 채워진다
    upsert: true,
  });

  if (error) {
    return { publicUrl: null, failure: 'upload-failed', detail: error.message, bytes: bytes.length };
  }

  const {
    data: { publicUrl },
  } = db.storage.from(COVERS_BUCKET).getPublicUrl(path);

  return { publicUrl, failure: null, bytes: bytes.length };
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}
