/**
 * 출처 tier 규칙.
 *
 * 검색 결과 URL을 코드에서 걸러낸다. 프롬프트에 맡기지 않는 이유는
 * tier 판정과 페이월 스킵이 재현 가능해야 하기 때문이다 (MASTER_PLAN §3).
 *
 * TODO(3.3): 도메인 목록을 채우고 혼합 URL 목록으로 검증한다.
 */

/**
 * Tier 1 — 1차 출처.
 * 논문·프리프린트, 공식 발표, 기관/기업 보도자료, 정부·기관 간행물.
 *
 * 서브도메인은 자동으로 포함된다 (news.mit.edu 는 mit.edu 에 걸린다).
 */
export const tier1Domains: readonly string[] = [
  // 학술지
  'nature.com', 'science.org', 'sciencemag.org', 'cell.com', 'thelancet.com',
  'nejm.org', 'pnas.org', 'plos.org', 'bmj.com', 'jamanetwork.com',
  'aps.org', 'acs.org', 'rsc.org', 'iop.org', 'aip.org', 'springer.com',
  'sciencedirect.com', 'wiley.com', 'frontiersin.org', 'elifesciences.org',
  // 프리프린트
  'arxiv.org', 'biorxiv.org', 'medrxiv.org', 'chemrxiv.org', 'ssrn.com',
  // 우주 기관
  'nasa.gov', 'esa.int', 'jaxa.jp', 'isro.gov.in', 'spacex.com', 'blueorigin.com',
  // 연구소
  'cern.ch', 'home.cern', 'fnal.gov', 'lbl.gov', 'ornl.gov', 'llnl.gov', 'anl.gov',
  'pnnl.gov', 'sandia.gov', 'nrel.gov', 'jpl.nasa.gov', 'mpg.de', 'cnrs.fr',
  'riken.jp', 'csiro.au', 'fraunhofer.de',
  // 보도자료 배포. 애그리게이터가 아니라 기관 발표를 그대로 싣는 곳이다
  'eurekalert.org',
  // 기업 연구 블로그 — 1차 발표이지만 제3자 검증이 없다.
  // 채점에서 impact 3 이상을 주지 않는다 (docs/RUBRIC.md 회색지대)
  'deepmind.google', 'openai.com', 'anthropic.com', 'ai.meta.com',
  'research.ibm.com', 'blogs.nvidia.com',
] as const;

/**
 * 도메인 접미사로 Tier 1 인 것.
 *
 * 대학·정부 기관은 수가 많아 개별 나열이 불가능하다.
 */
export const tier1Suffixes: readonly string[] = [
  '.edu', '.gov', '.ac.uk', '.edu.au', '.ac.jp', '.edu.cn', '.gov.uk',
] as const;

/**
 * Tier 2 — 기명 보도를 하는 주요 언론·방송.
 */
export const tier2Domains: readonly string[] = [
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk', 'npr.org',
  'theguardian.com', 'nytimes.com', 'washingtonpost.com', 'bloomberg.com',
  'arstechnica.com', 'spectrum.ieee.org', 'technologyreview.com',
  'scientificamerican.com', 'quantamagazine.org', 'newscientist.com',
  'wired.com', 'theverge.com', 'nikkei.com', 'dw.com', 'aljazeera.com',
  'space.com', 'sciencenews.org', 'chemistryworld.com', 'statnews.com',
] as const;

/**
 * 제외 — 출처로 쓰지 않는다.
 *
 * **주의: 피드로 쓰는 매체와 출처로 쓸 매체는 다르다.**
 * phys.org 와 sciencedaily.com 은 우리 피드지만(D-16) 출처로는 제외한다.
 * 둘 다 기관 보도자료를 재게시하는 곳이라, 원문 보도자료를 쓰면 되고
 * 재게시본을 인용하면 한 다리 건넌 셈이 된다 (기획서 §2.2).
 */
export const blockedDomains: readonly string[] = [
  // 애그리게이터·재게시
  'phys.org', 'sciencedaily.com', 'news.google.com', 'techmeme.com',
  'sciencealert.com', 'interestingengineering.com', 'zmescience.com',
  // 포럼·소셜
  'reddit.com', 'x.com', 'twitter.com', 'facebook.com', 'linkedin.com',
  'news.ycombinator.com', 'quora.com', 'stackexchange.com', 'stackoverflow.com',
  'youtube.com', 'tiktok.com', 'instagram.com',
  // 사용자 생성·품질 편차가 큰 곳
  'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com', 'wikipedia.org',
  // 추출이 거의 항상 실패하는 강한 페이월
  'wsj.com', 'ft.com', 'economist.com',
] as const;

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
