import Link from 'next/link';

import { CATEGORIES, categoryLabel } from '@/config/categories';

import type { Category } from '@/config/categories';
import type { Locale } from '@/config/locales';

/**
 * 카테고리·태그 필터 (로드맵 7.3).
 *
 * 링크다. 버튼이 아니다 — 필터 상태가 URL 에 있어야 공유되고, 뒤로 가기가
 * 동작하고, 서버에서 그려진다. `?category=` 는 D-15 가 정한 kebab 식별자를
 * 그대로 쓴다 (DB enum 값과 같아서 매핑 표가 없다).
 *
 * 카테고리가 7개뿐이라 접어두지 않는다 (D-15 — "3건 있는 날에 빈 절이 생기지 않을
 * 만큼만"). 태그는 목록에 나열하지 않는다. 수가 정해져 있지 않고, 기사에서
 * 눌러 들어오는 길만 있으면 된다.
 */
export function CategoryFilter({
  locale,
  active,
  tag,
}: {
  locale: Locale;
  active?: Category;
  tag?: string;
}) {
  const base = `/${locale}`;

  return (
    <nav className="flex flex-wrap items-center gap-1.5" aria-label="filter">
      <Chip href={base} label="All" active={!active && !tag} />

      {CATEGORIES.map((category) => (
        <Chip
          key={category.value}
          href={`${base}?category=${category.value}`}
          label={categoryLabel(category.value, locale)}
          active={category.value === active}
        />
      ))}

      {/* 태그로 좁힌 상태는 카테고리 칩으로 표현할 수 없다. 별도로 보여주고
          누르면 해제되도록 전체 링크를 준다 */}
      {tag ? <Chip href={base} label={`#${tag} ✕`} active /> : null}
    </nav>
  );
}

function Chip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-full bg-black px-2.5 py-1 text-xs text-white dark:bg-white dark:text-black'
          : 'rounded-full border border-black/15 px-2.5 py-1 text-xs text-black/60 hover:text-black dark:border-white/20 dark:text-white/60 dark:hover:text-white'
      }
    >
      {label}
    </Link>
  );
}
