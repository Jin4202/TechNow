import { ZERO_USAGE, addUsage, type AnthropicClient, type TokenUsage } from '@/clients/anthropic';
import { IMAGE_MODELS } from '@/clients/fal';
import { requiredAssets } from '@/config/required-assets';
import {
  articlesAwaitingAssets,
  insertTranslation,
  markArticleReady,
  saveCoverImageUrl,
  type PendingArticle,
} from '@/db/article-translations';
import { chooseCoverConcept } from '@/pipeline/illustrate/choose-concept';
import { uploadCover } from '@/pipeline/illustrate/upload-cover';
import { translateArticle } from '@/pipeline/translate/translate-article';
import { buildCoverPrompt } from '@/prompts/cover-image';

import type { FalClient } from '@/clients/fal';
import type { ServiceClient } from '@/db/supabase/service';
import type { ArticleSection } from '@/pipeline/write/write-article';

/**
 * 필수 자산 채우기 (로드맵 4.4, 4.6).
 *
 * 기사 본문이 있어도 필수 자산(`src/config/required-assets.ts`)이 다 모여야
 * 발행된다. 여기서 빠진 자산을 만들고, 다 모이면 `ready` 로 올린다.
 *
 * **두 곳에서 쓴다.**
 *   1. 기사를 방금 만든 직후 (build-topic) — 그날 아침 발행에 맞추기 위해
 *   2. 다음 런의 시작 (run-daily 의 스윕) — 어제 실패해 남은 기사를 위해
 *
 * 두 번째가 없으면 "실패하면 다음 런에서 재시도" (기획서 §2.3) 가 성립하지 않는다.
 * 일간 런은 어제의 토픽을 다시 보지 않으므로, 기사 쪽에서 훑어야 한다.
 *
 * Phase 5 의 커버 이미지도 같은 구조로 붙어 있다 — 자산이 하나 더 늘었을 뿐이다.
 */

export interface ArticleAssets {
  id: string;
  title: string;
  oneLineSummary: string;
  sections: readonly ArticleSection[];
  /** 이미 있는 번역본 언어 */
  locales: readonly string[];
  /** 이미 있는 커버 이미지 */
  coverImageUrl: string | null;
}

export interface FillResult {
  /** 자산이 다 모여 ready 로 올라갔는가 */
  ready: boolean;
  /** 만든 자산 */
  filled: string[];
  /** 실패한 자산과 사유 */
  failures: { asset: string; failure: string; detail: string }[];
  usage: TokenUsage;
  /** 이 호출에서 만든 이미지 수. 비용 로그의 cost_images (D-07) */
  imagesGenerated: number;
}

/**
 * 런 안에서 다시 해보는 횟수 (기획서 §2.3, §2.4 — "같은 런에서 1회 재시도").
 *
 * 두 자산이 같은 규칙을 쓴다. 실패가 이어지면 기사는 `ready_pending` 으로 남고
 * 다음 런의 스윕이 다시 시도한다 (D-33)
 */
const ATTEMPTS = 2;

export async function fillAssets(
  db: ServiceClient,
  claude: AnthropicClient,
  fal: FalClient,
  article: ArticleAssets,
): Promise<FillResult> {
  const filled: string[] = [];
  const failures: FillResult['failures'] = [];
  let usage = ZERO_USAGE;
  let imagesGenerated = 0;

  if (requiredAssets.includes('korean_translation') && !article.locales.includes('ko')) {
    const result = await translateWithRetry(claude, article);
    usage = addUsage(usage, result.usage);

    if (result.translation) {
      await insertTranslation(db, {
        articleId: article.id,
        locale: 'ko',
        title: result.translation.title,
        oneLineSummary: result.translation.oneLineSummary,
        body: { sections: result.translation.sections },
      });
      filled.push('korean_translation');
    } else {
      failures.push({
        asset: 'korean_translation',
        failure: result.failure ?? 'unknown',
        detail: result.detail ?? '',
      });
    }
  }

  if (requiredAssets.includes('cover_image') && !article.coverImageUrl) {
    const result = await illustrateWithRetry(db, claude, fal, article);
    usage = addUsage(usage, result.usage);
    imagesGenerated += result.images;

    if (result.publicUrl) {
      await saveCoverImageUrl(db, article.id, result.publicUrl);
      filled.push('cover_image');
    } else {
      failures.push({
        asset: 'cover_image',
        failure: result.failure ?? 'unknown',
        detail: result.detail ?? '',
      });
    }
  }

  // 실패한 자산이 하나라도 있으면 올리지 않는다. 반쪽 상태를 공개하지 않는다
  // (CLAUDE.md §5). 그대로 두면 다음 런의 스윕이 다시 시도한다
  const ready = failures.length === 0 ? await markArticleReady(db, article.id) : false;

  return { ready, filled, failures, usage, imagesGenerated };
}

/**
 * 커버 이미지 (로드맵 5.5).
 *
 * 세 단계다: 무엇을 그릴지 고르고(D-38) → 그리고 → 우리 Storage 로 옮긴다.
 * 셋 중 어디서 끊겨도 자산이 없는 것이므로 한 묶음으로 재시도한다.
 *
 * **상한은 여기서 건다** (CLAUDE.md §2.6). `budget.imagesPerArticle` 이 1 이고
 * 재시도까지 최대 2장이다 — 재시도가 상한을 우회하면 상한이 아니다.
 */
async function illustrateWithRetry(
  db: ServiceClient,
  claude: AnthropicClient,
  fal: FalClient,
  article: ArticleAssets,
): Promise<{
  publicUrl: string | null;
  failure: string | null;
  detail?: string;
  usage: TokenUsage;
  images: number;
}> {
  let usage = ZERO_USAGE;
  let images = 0;
  let last: { failure: string; detail?: string } = { failure: 'not-attempted' };

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const chosen = await chooseCoverConcept(claude, article);
    usage = addUsage(usage, chosen.usage);

    if (!chosen.concept) {
      last = { failure: `concept-${chosen.failure}`, detail: chosen.detail };
      continue;
    }

    let generatedUrl: string;
    try {
      const image = await fal.generate(IMAGE_MODELS.fluxSchnell, buildCoverPrompt(chosen.concept.scene));
      generatedUrl = image.url;
      images += 1;
    } catch (error) {
      last = { failure: 'generate-failed', detail: error instanceof Error ? error.message : String(error) };
      continue;
    }

    // fal 의 URL 은 남의 서버다. 우리 Storage 로 옮겨야 자산이 된다 (5.3)
    const uploaded = await uploadCover(db, article.id, generatedUrl);
    if (uploaded.publicUrl) {
      return { publicUrl: uploaded.publicUrl, failure: null, usage, images };
    }

    last = { failure: uploaded.failure ?? 'upload-failed', detail: uploaded.detail };
  }

  return { publicUrl: null, failure: last.failure, detail: last.detail, usage, images };
}

/**
 * 번역 1회 재시도.
 *
 * 재시도에 첫 실패 사유를 붙인다 — 구조가 어긋난 것이 대부분이고(4.3a),
 * 무엇이 어긋났는지 알려주면 같은 실수를 반복하지 않는다.
 */
async function translateWithRetry(claude: AnthropicClient, article: ArticleAssets) {
  let usage = ZERO_USAGE;
  let last: Awaited<ReturnType<typeof translateArticle>> | null = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const retryNote = last?.failure ? `${last.failure}: ${last.detail ?? ''}` : undefined;

    last = await translateArticle(
      claude,
      {
        title: article.title,
        oneLineSummary: article.oneLineSummary,
        sections: article.sections,
      },
      retryNote,
    );
    usage = addUsage(usage, last.usage);

    if (last.translation) break;
  }

  return { ...last!, usage };
}

/**
 * 이전 런에서 남은 기사들의 자산을 채운다 (스윕).
 *
 * 일간 런의 **앞**에서 돈다. 어제 것이 오늘 아침 발행에 들어가야 하고,
 * 오늘 기사를 만들다 예산이나 시간이 모자라도 어제 것은 이미 끝나 있어야 한다.
 */
export interface SweepResult {
  scanned: number;
  promoted: number;
  stillWaiting: number;
  usage: TokenUsage;
  imagesGenerated: number;
}

export async function sweepPendingAssets(
  db: ServiceClient,
  claude: AnthropicClient,
  fal: FalClient,
  options: { onInfo?: (message: string, data: Record<string, unknown>) => void } = {},
): Promise<SweepResult> {
  const pending: PendingArticle[] = await articlesAwaitingAssets(db);

  let promoted = 0;
  let usage = ZERO_USAGE;
  let imagesGenerated = 0;

  for (const article of pending) {
    const result = await fillAssets(db, claude, fal, article);
    usage = addUsage(usage, result.usage);
    imagesGenerated += result.imagesGenerated;

    if (result.ready) promoted += 1;
    else {
      options.onInfo?.('자산을 아직 못 채웠다', {
        articleId: article.id,
        failures: result.failures,
      });
    }
  }

  return {
    scanned: pending.length,
    promoted,
    stillWaiting: pending.length - promoted,
    usage,
    imagesGenerated,
  };
}
