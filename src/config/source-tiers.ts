/**
 * 출처 tier 규칙.
 *
 * 검색 결과 URL을 코드에서 걸러낸다. 프롬프트에 맡기지 않는 이유는
 * tier 판정과 페이월 스킵이 재현 가능해야 하기 때문이다 (MASTER_PLAN §3).
 *
 * TODO(3.3): 도메인 목록을 채우고 혼합 URL 목록으로 검증한다.
 */

/** Tier 1 — 1차 출처. 논문·프리프린트, 공식 발표, 기관/기업 보도자료, 정부·기관 간행물 */
export const tier1Domains: readonly string[] = [] as const;

/** Tier 2 — 기명 보도를 하는 주요 언론·방송 */
export const tier2Domains: readonly string[] = [] as const;

/** 제외 — 애그리게이터, 콘텐츠 팜, 포럼, 소셜, SEO 블로그 */
export const blockedDomains: readonly string[] = [] as const;

/**
 * 페이월 감지 문구.
 * 추출된 본문이 너무 짧거나 이 문구를 포함하면 페이월로 보고 건너뛴다.
 */
export const paywallMarkers: readonly string[] = [
  'subscribe to continue',
  'subscribers only',
  'create a free account to read',
  'sign in to read',
] as const;

/** 이보다 짧게 추출되면 페이월이나 추출 실패로 본다 (문자 수) */
export const minExtractedChars = 800;

/**
 * 협찬 기사 표시.
 *
 * 제목만으로는 알 수 없다 — IEEE Spectrum 의
 * "Protecting Dynamic Industrial Robot Cable Carriers" 는 제목이 멀쩡한데
 * 본문 첫 줄이 "This article is brought to you by ..." 였다.
 * 저비용 필터(2.1)는 제목만 보므로 여기서 잡는다.
 *
 * 협찬 기사는 출처가 될 수 없다 (기획서 §2.2 의 제외 목록).
 */
export const sponsoredMarkers: readonly string[] = [
  'brought to you by',
  'sponsored content',
  'paid content',
  'in partnership with',
  'this post is sponsored',
  'advertorial',
] as const;

/** 협찬 표시는 본문 앞부분에 온다. 뒤쪽의 우연한 일치를 피한다 */
export const sponsoredCheckChars = 500;
