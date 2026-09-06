import { describe, expect, it } from 'vitest';

import { FalClient, FalError, IMAGE_MODELS, IMAGE_PRICING } from '@/clients/fal';

/**
 * fal.ai 클라이언트 (로드맵 5.1, 5.3).
 *
 * 네트워크를 타지 않는다. 확인하는 것은 요청 조립과 실패 처리다 —
 * 이미지가 예쁜지는 사람이 `pnpm covers:bakeoff` 로 본다.
 */

const OK_BODY = {
  images: [{ url: 'https://fal.media/files/x.jpg', width: 1024, height: 576, content_type: 'image/jpeg' }],
  seed: 7,
};

function client(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];

  const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init.body ?? '{}')),
      headers: init.headers as Record<string, string>,
    });
    return handler(String(url), init);
  }) as unknown as typeof fetch;

  return { fal: new FalClient({ apiKey: 'test-key', fetchImpl }), calls };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe('FalClient', () => {
  it('모델 경로와 Key 헤더로 부른다', async () => {
    const { fal, calls } = client(() => json(OK_BODY));

    await fal.generate(IMAGE_MODELS.fluxSchnell, 'a calm illustration');

    expect(calls[0]!.url).toBe('https://fal.run/fal-ai/flux/schnell');
    expect(calls[0]!.headers.Authorization).toBe('Key test-key');
    expect(calls[0]!.body.prompt).toBe('a calm illustration');
  });

  it('모델마다 받는 파라미터가 다르다', async () => {
    // 커버는 가로형이다. 비율을 안 주면 정사각형이 나와 카드 레이아웃이 깨진다
    const flux = client(() => json(OK_BODY));
    await flux.fal.generate(IMAGE_MODELS.fluxSchnell, 'x');
    expect(flux.calls[0]!.body.image_size).toBe('landscape_16_9');
    expect(flux.calls[0]!.body.output_format).toBe('jpeg');

    const recraft = client(() => json(OK_BODY));
    await recraft.fal.generate(IMAGE_MODELS.recraftV3, 'x');
    expect(recraft.calls[0]!.body.image_size).toBe('landscape_16_9');
    // output_format 은 Flux 만 받는다. 다른 모델에 보내면 422 다
    expect(recraft.calls[0]!.body.output_format).toBeUndefined();
  });

  it('한 번에 한 장만 만든다 (기획서 §2.4)', async () => {
    const { fal, calls } = client(() => json(OK_BODY));
    await fal.generate(IMAGE_MODELS.fluxSchnell, 'x');
    expect(calls[0]!.body.num_images).toBe(1);
  });

  it('만든 장 수를 센다 — 상한 강제는 호출자가 한다 (CLAUDE.md §2.6)', async () => {
    const { fal } = client(() => json(OK_BODY));

    await fal.generate(IMAGE_MODELS.fluxSchnell, 'x');
    await fal.generate(IMAGE_MODELS.fluxSchnell, 'y');

    expect(fal.imageCount).toBe(2);
  });

  it('HTTP 실패를 던진다', async () => {
    const { fal } = client(() => json({ detail: 'nope' }, 422));
    await expect(fal.generate(IMAGE_MODELS.fluxSchnell, 'x')).rejects.toThrow(FalError);
  });

  it('응답 형식이 다르면 던진다', async () => {
    // 조용히 빈 결과가 되면 자산 없는 기사가 ready 로 올라간다
    const { fal } = client(() => json({ images: [] }));
    await expect(fal.generate(IMAGE_MODELS.fluxSchnell, 'x')).rejects.toThrow(FalError);
  });

  it('안전 필터에 걸리면 실패로 다룬다', async () => {
    const { fal } = client(() => json({ ...OK_BODY, has_nsfw_concepts: [true] }));

    await expect(fal.generate(IMAGE_MODELS.fluxSchnell, 'x')).rejects.toThrow(/안전 필터/);
    // 실패한 호출은 세지 않는다 — 비용 로그가 실제 청구와 어긋난다
    expect(fal.imageCount).toBe(0);
  });

  it('실패한 요청은 장 수에 들어가지 않는다', async () => {
    const { fal } = client(() => json({ detail: 'nope' }, 500));
    await expect(fal.generate(IMAGE_MODELS.fluxSchnell, 'x')).rejects.toThrow();
    expect(fal.imageCount).toBe(0);
  });
});

describe('IMAGE_PRICING', () => {
  it('대안들이 Flux 보다 훨씬 비싸다 — 5.1 의 판단 기준이다', () => {
    // 격차가 분명할 때만 비싼 쪽으로 간다 (기획서 §7)
    expect(IMAGE_PRICING[IMAGE_MODELS.recraftV3]).toBeGreaterThan(
      IMAGE_PRICING[IMAGE_MODELS.fluxSchnell] * 5,
    );
    expect(IMAGE_PRICING[IMAGE_MODELS.ideogramV2]).toBeGreaterThan(
      IMAGE_PRICING[IMAGE_MODELS.recraftV3],
    );
  });

  it('하루 3장이 월 예산에서 차지하는 비중이 작다', () => {
    // Flux 기준 월 $0.27. 이미지가 예산을 좌우하지 않는다 (D-36 의 문제는 Claude 쪽이다)
    const monthly = IMAGE_PRICING[IMAGE_MODELS.fluxSchnell] * 3 * 30;
    expect(monthly).toBeLessThan(1);
  });
});
