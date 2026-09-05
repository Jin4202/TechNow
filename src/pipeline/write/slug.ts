/**
 * 기사 URL 슬러그.
 *
 * `articles.slug` 는 unique 다. 충돌하면 삽입이 통째로 실패하므로
 * 해시 접미사를 항상 붙인다 — 한국어나 기호만 있는 제목은 앞부분이 통째로 비어
 * 두 번째 기사부터 충돌한다.
 */
export function makeSlug(title: string, hash: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');

  const suffix = hash.slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}
