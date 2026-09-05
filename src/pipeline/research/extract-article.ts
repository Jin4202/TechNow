import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

import {
  minExtractedChars,
  paywallMarkers,
  sponsoredCheckChars,
  sponsoredMarkers,
} from '@/config/source-tiers';

/**
 * HTML 에서 본문을 뽑아낸다 (로드맵 3.4, 2.5 에서 먼저 쓴다).
 *
 * 순수 함수다. 네트워크는 fetch-page.ts 가 맡는다.
 *
 * 추출 품질이 토큰 비용을 좌우한다. 네비게이션과 광고가 섞여 들어오면
 * 그만큼 조사·작성·검증 단계에서 반복 지불한다 (MASTER_PLAN §3).
 */

export type ExtractionFailure =
  /** Readability 가 본문을 찾지 못함 */
  | 'no-content'
  /** 너무 짧다. 페이월이거나 추출 실패 */
  | 'too-short'
  /** 구독 유도 문구가 있다 */
  | 'paywalled';

export interface ExtractionSuccess {
  ok: true;
  title: string | null;
  text: string;
  /** 매체명. Readability 가 찾아내면 */
  siteName: string | null;
  excerpt: string | null;
  /**
   * 협찬 기사로 보이는가.
   *
   * 실패로 처리하지 않는다 — 재채점(2.5)에서는 점수가 낮게 나가면 그만이고,
   * 조사 단계(3.5)에서 출처로 쓸지 말지는 호출자가 정한다
   */
  sponsored: boolean;
}

export interface ExtractionError {
  ok: false;
  reason: ExtractionFailure;
  /** 진단용. 짧게라도 뭔가 뽑혔다면 */
  chars: number;
}

export type ExtractionResult = ExtractionSuccess | ExtractionError;

/** 연속 공백을 정리한다. 토큰 낭비를 줄인다 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

export function looksPaywalled(text: string): boolean {
  const lower = text.toLowerCase();
  return paywallMarkers.some((marker) => lower.includes(marker));
}

/** 협찬 표시는 본문 앞부분에 온다 */
export function looksSponsored(text: string): boolean {
  const head = text.slice(0, sponsoredCheckChars).toLowerCase();
  return sponsoredMarkers.some((marker) => head.includes(marker));
}

export function extractArticle(html: string, url: string): ExtractionResult {
  let text = '';
  let title: string | null = null;
  let siteName: string | null = null;
  let excerpt: string | null = null;

  try {
    const { document } = parseHTML(html);
    // Readability 는 document.baseURI 로 상대 링크를 푼다
    const parsed = new Readability(document as unknown as Document, {
      // 본문 판정을 조금 관대하게. 짧은 보도자료가 통째로 버려지는 걸 막는다
      charThreshold: 250,
    }).parse();

    if (parsed) {
      text = normalizeWhitespace(parsed.textContent ?? '');
      title = parsed.title?.trim() || null;
      siteName = parsed.siteName?.trim() || null;
      excerpt = parsed.excerpt?.trim() || null;
    }
  } catch {
    // 깨진 HTML. 아래 no-content 로 떨어진다
  }

  if (!text) return { ok: false, reason: 'no-content', chars: 0 };

  // 페이월 판정을 길이보다 먼저 본다. 사유가 더 정확하다
  if (looksPaywalled(text)) return { ok: false, reason: 'paywalled', chars: text.length };
  if (text.length < minExtractedChars) return { ok: false, reason: 'too-short', chars: text.length };

  void url;
  return { ok: true, title, text, siteName, excerpt, sponsored: looksSponsored(text) };
}
