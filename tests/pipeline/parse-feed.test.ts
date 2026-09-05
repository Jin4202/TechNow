import { describe, expect, it } from 'vitest';

import { parseFeed } from '@/pipeline/discover/parse-feed';

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Science</title>
    <item>
      <title>New battery lasts 3 &lt; 5 times longer</title>
      <link>https://example.org/battery?utm_source=rss</link>
      <description>&lt;p&gt;Researchers &lt;b&gt;report&lt;/b&gt; a new cathode.&lt;/p&gt;</description>
      <pubDate>Wed, 03 Sep 2026 10:30:00 GMT</pubDate>
    </item>
    <item>
      <title>Telescope spots distant galaxy</title>
      <link>https://example.org/galaxy</link>
      <description>A faint smudge.</description>
      <pubDate>invalid date</pubDate>
    </item>
    <item>
      <title>제목만 있고 링크 없음</title>
      <description>버려져야 한다</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Tech</title>
  <entry>
    <title>Chip fab opens</title>
    <link rel="alternate" href="https://example.com/fab"/>
    <link rel="edit" href="https://example.com/edit/fab"/>
    <summary>A new plant.</summary>
    <published>2026-09-02T08:00:00Z</published>
  </entry>
  <entry>
    <title>Robot walks</title>
    <link href="https://example.com/robot"/>
    <content>It walked.</content>
    <updated>2026-09-01T00:00:00Z</updated>
  </entry>
</feed>`;

describe('parseFeed — RSS 2.0', () => {
  const items = parseFeed(RSS, 'example');

  it('링크나 제목이 없는 항목은 버린다', () => {
    expect(items).toHaveLength(2);
  });

  it('XML 엔티티를 되돌린다', () => {
    expect(items[0]!.title).toBe('New battery lasts 3 < 5 times longer');
  });

  it('설명에서 HTML 태그를 걷어낸다', () => {
    expect(items[0]!.description).toBe('Researchers report a new cathode.');
  });

  it('날짜를 파싱한다', () => {
    expect(items[0]!.publishedAt?.toISOString()).toBe('2026-09-03T10:30:00.000Z');
  });

  it('날짜가 깨졌으면 null 이다 (항목을 버리지는 않는다)', () => {
    expect(items[1]!.publishedAt).toBeNull();
  });

  it('feedName 을 붙이고 URL 해시를 만든다', () => {
    expect(items[0]!.feedName).toBe('example');
    expect(items[0]!.urlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('추적 파라미터가 달라도 해시가 같다', () => {
    const other = parseFeed(RSS.replace('?utm_source=rss', '?utm_campaign=x'), 'example');
    expect(other[0]!.urlHash).toBe(items[0]!.urlHash);
  });
});

describe('parseFeed — Atom', () => {
  const items = parseFeed(ATOM, 'atom-example');

  it('entry 를 항목으로 읽는다', () => {
    expect(items).toHaveLength(2);
  });

  it('link 가 여러 개면 alternate 를 고른다', () => {
    expect(items[0]!.url).toBe('https://example.com/fab');
  });

  it('rel 없는 link 도 받는다', () => {
    expect(items[1]!.url).toBe('https://example.com/robot');
  });

  it('summary 와 content 를 모두 설명으로 쓴다', () => {
    expect(items[0]!.description).toBe('A new plant.');
    expect(items[1]!.description).toBe('It walked.');
  });

  it('published 가 없으면 updated 를 쓴다', () => {
    expect(items[1]!.publishedAt?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('parseFeed — 깨진 입력', () => {
  it('빈 채널은 빈 배열', () => {
    expect(parseFeed('<rss version="2.0"><channel/></rss>', 'x')).toEqual([]);
  });

  it('항목이 하나뿐이어도 배열로 다룬다', () => {
    const one = `<rss version="2.0"><channel><item>
      <title>Only one</title><link>https://example.org/one</link>
    </item></channel></rss>`;
    expect(parseFeed(one, 'x')).toHaveLength(1);
  });

  it('숫자처럼 보이는 제목도 문자열로 다룬다', () => {
    const numeric = `<rss version="2.0"><channel><item>
      <title>2026</title><link>https://example.org/n</link>
    </item></channel></rss>`;
    expect(parseFeed(numeric, 'x')[0]!.title).toBe('2026');
  });

  it('RSS 도 Atom 도 아니면 빈 배열', () => {
    expect(parseFeed('<html><body>nope</body></html>', 'x')).toEqual([]);
  });
});

describe('parseFeed — HTML 엔티티', () => {
  const withEntities = (desc: string) =>
    parseFeed(
      `<rss version="2.0"><channel><item>
        <title>T</title><link>https://example.org/e</link>
        <description>${desc}</description>
      </item></channel></rss>`,
      'x',
    )[0]!.description;

  it('태그를 걷어낸 뒤 남은 숫자 엔티티를 푼다', () => {
    // 피드가 이중 인코딩해 보내는 흔한 경우
    expect(withEntities('&lt;p&gt;student&amp;#039;s work&lt;/p&gt;')).toBe("student's work");
  });

  it('16진 엔티티를 푼다', () => {
    expect(withEntities('&lt;p&gt;it&amp;#x27;s&lt;/p&gt;')).toBe("it's");
  });

  it('이름 있는 엔티티를 푼다', () => {
    expect(withEntities('a &amp;mdash; b &amp;nbsp; c')).toBe('a — b c');
  });

  it('모르는 엔티티는 그대로 둔다', () => {
    expect(withEntities('&amp;unknownthing;')).toBe('&unknownthing;');
  });

  it('태그를 먼저 지우므로 이스케이프된 스크립트가 사라지지 않는다', () => {
    expect(withEntities('&lt;p&gt;a &amp;lt;script&amp;gt; b&lt;/p&gt;')).toBe('a <script> b');
  });
});
