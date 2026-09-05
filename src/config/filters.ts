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
