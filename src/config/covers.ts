import { IMAGE_MODELS, IMAGE_PRICING, type ImageModel } from '@/clients/fal';

/**
 * 커버 생성 설정 (7.9, D-52).
 *
 * 모델을 `fill-assets.ts` 가 하드코딩하고 있었다. 튜닝 값은 코드가 아니라
 * config 에 둔다 (CLAUDE.md §2.4) — 모델을 바꾸려고 파이프라인 로직을 고치는 것은
 * 그 규칙 위반이다.
 */

/**
 * 커버를 만드는 모델.
 *
 * Flux schnell → **Flux Pro v1.1 Ultra** (2026-09-06, 사용자 결정).
 *
 * 근거: 실제 기사 5건으로 4개 모델을 비교했다 (`pnpm covers:bakeoff`, $0.475).
 * Ultra 는 추상 주제에서도 무너지지 않았다 — 단백질 구조 예측, 플라스마 제어처럼
 * 평면 벡터 화풍이 색면을 내던 유형(D-37)에서 격차가 가장 컸다.
 *
 * ⚠️ **장당 단가가 20배다** ($0.003 → $0.06). 하루 5편이면 월 $9 이고
 * 사용자가 정한 이미지 예산 $8 을 상한에서 넘는다. 최근 실측인 하루 2~3편에서는
 * $3.6~5.4 다. 편수가 상한에 붙으면 다시 판단한다.
 *
 * 이미지 비용은 **변동비에 잡힌다** (`variableCostUsd`, 2026-09-07에 고쳤다).
 * 그 전에는 `cost_images` 에 장수만 저장하고 달러로 환산하지 않아 월 추정에서
 * 통째로 빠져 있었다 — schnell 시절 월 $0.45 라 넘어갔지만 20배가 되면서
 * 계기가 고장난 상태가 됐다.
 */
export const coverModel: ImageModel = IMAGE_MODELS.fluxProUltra;

/** 이 모델의 장당 단가. 예산 이야기를 할 때 리터럴을 다시 쓰지 않기 위해 둔다 */
export const coverUsdPerImage = IMAGE_PRICING[coverModel];
