import { XMLParser } from 'fast-xml-parser';

import { urlHash } from './normalize-url';

/**
 * RSS 2.0 / Atom 피드를 항목 목록으로 바꾼다.
 *
 * 순수 함수다. 네트워크를 타지 않으므로 고정된 XML 로 테스트할 수 있다.
 *
 * RSS 1.0(RDF)은 다루지 않는다. 현재 피드 목록에 없다 (D-16 참고).
 */

export interface FeedItem {
  urlHash: string;
  feedName: string;
  title: string;
  description: string;
  url: string;
  /** 피드가 날짜를 안 주거나 파싱에 실패하면 null */
  publishedAt: Date | null;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  // <title>3 &lt; 5</title> 같은 엔티티를 되돌린다
  processEntities: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** fast-xml-parser 는 값이 숫자처럼 보이면 number 로 준다 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object' && '#text' in value) {
    return asText((value as { '#text': unknown })['#text']);
  }
  return '';
}

function parseDate(value: unknown): Date | null {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  ldquo: '\u201c',
  rdquo: '\u201d',
};

/**
 * HTML 엔티티를 되돌린다.
 *
 * 피드 설명은 이중 인코딩되어 오는 경우가 많다. XML 파서가 한 번 풀면
 * `<p>It&#039;s ...</p>` 가 남고, 태그만 걷어내면 `&#039;` 가 본문에 그대로 노출된다.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/** HTML 설명에서 태그를 걷어낸다. 저비용 필터가 길이를 재야 하므로 */
function stripHtml(html: string): string {
  // 태그를 먼저 지우고 엔티티를 푼다. 순서가 반대면 &lt;script&gt; 가 태그가 되어 사라진다
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

type XmlNode = Record<string, unknown>;

/** 중첩된 노드를 타입 단언 없이 따라간다 */
function child(node: unknown, key: string): unknown {
  if (node && typeof node === 'object' && key in node) {
    return (node as XmlNode)[key];
  }
  return undefined;
}

/** Atom 의 link 는 속성에 URL 이 있고 여러 개일 수 있다 */
function atomLink(entry: XmlNode): string {
  const links = asArray(entry.link as Record<string, unknown> | Record<string, unknown>[]);
  const alternate = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate') ?? links[0];
  if (!alternate) return '';
  return asText(alternate['@_href']) || asText(alternate);
}

export function parseFeed(xml: string, feedName: string): FeedItem[] {
  const doc: unknown = parser.parse(xml);

  const rssItems = asArray(child(child(child(doc, 'rss'), 'channel'), 'item') as XmlNode | XmlNode[] | undefined);
  const atomEntries = asArray(child(child(doc, 'feed'), 'entry') as XmlNode | XmlNode[] | undefined);

  const raw = rssItems.length > 0 ? rssItems : atomEntries;
  const isAtom = rssItems.length === 0 && atomEntries.length > 0;

  const items: FeedItem[] = [];

  for (const entry of raw) {
    const url = isAtom ? atomLink(entry) : asText(entry.link);
    const title = asText(entry.title);

    // URL 이나 제목이 없으면 토픽 후보가 될 수 없다
    if (!url || !title) continue;

    const description = stripHtml(
      asText(entry.description) || asText(entry.summary) || asText(entry.content),
    );

    items.push({
      urlHash: urlHash(url),
      feedName,
      title,
      description,
      url,
      publishedAt: parseDate(entry.pubDate ?? entry.published ?? entry.updated),
    });
  }

  return items;
}
