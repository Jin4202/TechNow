/**
 * 저비용 필터 설정 (로드맵 2.1).
 *
 * LLM 을 부르기 전에 코드로 걸러낸다. 목적은 비용 절감이지 정확한 분류가 아니다.
 *
 * **보수적으로 잡는다.** 좋은 토픽을 죽이는 것(위양성)이 잡음을 통과시키는 것보다
 * 훨씬 나쁘다. 통과한 잡음은 Haiku 채점에서 낮은 점수를 받고 탈락하지만,
 * 여기서 죽은 토픽은 아무도 다시 보지 않는다.
 * 애매하면 통과시키고 채점에 맡긴다.
 *
 * 패턴은 실제 수집 데이터를 보고 만들었다. 추측으로 추가하지 말 것.
 */

/** 이보다 짧은 제목은 토픽이 될 만한 정보가 없다 */
export const MIN_TITLE_LENGTH = 15;

/**
 * 이보다 오래된 항목은 뉴스가 아니다.
 *
 * **파이프라인에 나이 제한이 아예 없었다** (2026-09-06 발견). `publishedAt` 은
 * parse-feed 가 파싱만 하고 아무 데서도 쓰지 않았다.
 *
 * 피드별 실측:
 *   phys-org       중앙 1.2일  최고령    2.0일
 *   science-daily  중앙 3.4일  최고령    7.4일
 *   ars-technica   중앙 2.2일  최고령    3.1일
 *   nasa           중앙 2.8일  최고령    3.4일
 *   ieee-spectrum  중앙 13.2일 최고령 1672.3일  ← 2021년 기사 3건을 상시 내보낸다
 *
 * 그 3건("Andrew Ng: Unbiggen AI" 등)은 아래 어느 패턴에도 안 걸리고, 채점기는
 * 날짜를 받지 않아 4년 전 글인지 알 방법이 없다. 지금까지 안 터진 건
 * seen_feed_items 중복 제거 덕인데 processedRetentionDays 가 90일이라
 * 90일 뒤 다시 후보가 된다.
 *
 * **30일인 이유**: IEEE 중앙값이 13.2일이라 14일로 잡으면 IEEE 항목 절반이 죽는다.
 * IEEE 는 robotics-hardware 와 industry-policy 를 덮는 두 피드 중 하나다 (D-16).
 * 이미 좁은 카테고리 공급을 더 좁히지 않으면서 2021년 3건만 걸러내는 값이 30일이다.
 */
export const MAX_ITEM_AGE_DAYS = 30;

/**
 * 설명 길이는 필터로 쓰지 않는다.
 *
 * Ars Technica 의 설명은 48~115자인데 "Second complete map of a fruit fly brain
 * completed" 같은 중요한 기사가 그 안에 있다. 길이는 중요도의 신호가 아니다.
 */

/**
 * 홍보·거래 글.
 * 아직 수집 표본에는 없었지만 기술 매체가 주기적으로 내보낸다.
 */
export const PROMOTIONAL_PATTERNS: readonly RegExp[] = [
  /\b(deal|deals|discount|coupon|promo code|on sale|save \$?\d)\b/i,
  /\bbest .{0,30}\b(of|for) (20\d\d|beginners|students)\b/i,
  /\b(buying guide|gift guide|prime day|black friday|cyber monday)\b/i,
  /\bsponsored\b/i,
];

/**
 * 학회·단체의 내부 소식과 커리어 조언.
 *
 * IEEE Spectrum 피드의 상당 부분이 회원 소식·멘토십·수상 안내다.
 * 기술 내용이 아니라 조직 운영에 관한 글이다.
 */
export const ORGANIZATIONAL_PATTERNS: readonly RegExp[] = [
  /\bIEEE (president|senior member|member|fellow|milestone|student|scholarship|awards?)\b/i,
  /\b(membership|scholarship|student conference|call for papers|mentorship|mentoring)\b/i,
  /\b(what it takes to|how to get|gaining .{0,20}backing|bring a .{0,20}mindset)\b/i,
  /\bpoetry for\b/i,
];

/** 부고. 업적 자체가 새 정보는 아니다 (RUBRIC 회색지대 참고) */
export const OBITUARY_PATTERNS: readonly RegExp[] = [
  /\bdies? at \d{1,3}\b/i,
  /\b(obituary|in memoriam|passes away|1?9\d\d\s*[-–]\s*20\d\d)\b/i,
];

/**
 * 우리 7개 카테고리 밖의 주제.
 *
 * phys.org 는 사회과학·교육 연구를 많이 싣는다. 좋은 연구지만 이 사이트의 범위가
 * 아니다. 다만 "students" 같은 단어는 정상 기사에도 나오므로 **주제 자체가
 * 사회현상인 경우**로 좁혔다.
 */
export const OFF_TOPIC_PATTERNS: readonly RegExp[] = [
  /\b(school suspension|pupils?|classroom|teachers?|curriculum|undergraduates?)\b/i,
  // 복수형 주의: \bmarriage\b 는 "marriages" 에 걸리지 않는다
  /\b(marriages?|divorces?|religio(n|us)|mosques?|church(es)?|voters?|electoral)\b/i,
  /\b(sports? bets?|football|soccer|olympics?|basketball|world cup)\b/i,
  /\b(box office|celebrit(y|ies)|movies?|film festival|albums?|streaming series)\b/i,
];

export interface FilterRule {
  name: string;
  patterns: readonly RegExp[];
}

/** 적용 순서대로. 먼저 걸린 규칙이 탈락 사유가 된다 */
export const FILTER_RULES: readonly FilterRule[] = [
  { name: 'promotional', patterns: PROMOTIONAL_PATTERNS },
  { name: 'organizational', patterns: ORGANIZATIONAL_PATTERNS },
  { name: 'obituary', patterns: OBITUARY_PATTERNS },
  { name: 'off-topic', patterns: OFF_TOPIC_PATTERNS },
];
