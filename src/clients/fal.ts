import { z } from 'zod';

/**
 * fal.ai 이미지 생성 클라이언트 (로드맵 5.1, 5.3).
 *
 * SDK 대신 HTTP 를 직접 부른다. 우리가 쓰는 것은 동기 엔드포인트 하나뿐이고
 * (`POST https://fal.run/<model>`), Brave 클라이언트도 같은 방식이다.
 * 의존성이 하나 줄고 응답을 zod 로 검증하는 자리가 생긴다.
 *
 * **호출 상한은 호출자가 건다** (CLAUDE.md §2.6). 이 클래스는 쓴 횟수를 셀 뿐이다 —
 * 기사당 이미지 1장(`budget.imagesPerArticle`)은 파이프라인 쪽에서 강제한다.
 */

/**
 * 5.1 비교 대상. 값은 fal 의 모델 경로다.
 *
 * **Imagen 4 는 목록에 없다.** 기획서 §7 이 대안으로 지목했지만 이 계정에서
 * `fal-ai/imagen4/*` 는 어떤 경로로도 404 다 ("Application imagen4 not found",
 * 2026-09-06 실측). fal 에서 내려갔거나 별도 승인이 필요하다.
 * 그 자리는 실제로 부를 수 있는 모델로 채운다.
 */
export const IMAGE_MODELS = {
  /** 기본 후보. 장당 약 $0.003, Apache 2.0 (기획서 §7) */
  fluxSchnell: 'fal-ai/flux/schnell',
  /** 벡터·플랫 일러스트에 강한 대안 */
  recraftV3: 'fal-ai/recraft-v3',
  /** 디자인·일러스트 대안 */
  ideogramV2: 'fal-ai/ideogram/v2',
} as const;

export type ImageModel = (typeof IMAGE_MODELS)[keyof typeof IMAGE_MODELS];

/** 장당 단가 (USD). 비용 로그(D-07)의 `cost_images` 용 */
export const IMAGE_PRICING: Record<ImageModel, number> = {
  [IMAGE_MODELS.fluxSchnell]: 0.003,
  [IMAGE_MODELS.recraftV3]: 0.04,
  [IMAGE_MODELS.ideogramV2]: 0.08,
};

const ImageSchema = z.object({
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  content_type: z.string().optional(),
});

const ResponseSchema = z.object({
  images: z.array(ImageSchema).min(1),
  seed: z.number().optional(),
  has_nsfw_concepts: z.array(z.boolean()).optional(),
});

export interface GeneratedImage {
  url: string;
  width: number | null;
  height: number | null;
  contentType: string;
}

export interface FalClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class FalError extends Error {}

const BASE_URL = 'https://fal.run';

export class FalClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  /** 이 클라이언트가 만든 이미지 수. 상한 강제는 호출자가 한다 */
  public imageCount = 0;

  constructor(options: FalClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.FAL_KEY;
    if (!apiKey) {
      throw new Error('FAL_KEY 가 필요합니다. Trigger.dev 환경변수를 확인하세요.');
    }
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * 이미지 한 장.
   *
   * 커버는 가로형이다 — 목록 카드와 상세 상단이 둘 다 가로다 (5.6).
   */
  async generate(
    model: ImageModel,
    prompt: string,
    options: { seed?: number } = {},
  ): Promise<GeneratedImage> {
    // 비율 파라미터 이름이 모델마다 다르다. Flux 계열은 `image_size`,
    // Recraft·Ideogram 은 문자열 이름이 다른 `image_size` 를 쓴다
    const body: Record<string, unknown> = {
      prompt,
      num_images: 1,
      image_size: 'landscape_16_9',
      ...(model === IMAGE_MODELS.fluxSchnell ? { output_format: 'jpeg' } : {}),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
    };

    const response = await this.fetchImpl(`${BASE_URL}/${model}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // 생성은 몇 초에서 수십 초 걸린다. Brave 보다 넉넉히 잡는다
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new FalError(`이미지 생성 실패: HTTP ${response.status} ${text.slice(0, 300)}`);
    }

    const parsed = ResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new FalError(`fal 응답 형식이 예상과 다릅니다: ${parsed.error.message}`);
    }

    // 안전 필터에 걸리면 이미지가 비어 나오거나 검은 화면이 온다.
    // 조용히 넘기지 않는다 — 발행 자산이라 사람이 알아야 한다
    if (parsed.data.has_nsfw_concepts?.some(Boolean)) {
      throw new FalError('안전 필터에 걸렸습니다. 프롬프트를 확인하세요');
    }

    this.imageCount += 1;
    const image = parsed.data.images[0]!;

    return {
      url: image.url,
      width: image.width ?? null,
      height: image.height ?? null,
      contentType: image.content_type ?? 'image/jpeg',
    };
  }
}
