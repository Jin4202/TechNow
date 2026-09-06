import { spawnSync } from 'node:child_process';

import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServiceClient } from '@/db/supabase/service';

import type { Database } from '@/db/types';

/**
 * 데이터 격리 검증 (로드맵 7.6, 7.6a). 실행: pnpm isolation:check
 *
 * 공개 전에 반드시 통과해야 한다. 여기가 뚫리면 게이트를 푸는 순간
 * 발행 전 기사와 남의 스크랩이 새어나간다.
 *
 * **두 층을 따로 본다.**
 *   1. 익명(anon 키) — 실제 앱이 쓰는 클라이언트 그대로. 무엇이 보이고 무엇이 막히나
 *   2. 사용자 대 사용자 — RLS 정책 수준에서 검사한다. 로그인 계정을 만들지 않고
 *      `request.jwt.claims` 를 세션처럼 넣어 정책이 실제로 무엇을 막는지 본다
 *
 * 비용 0. 네트워크는 로컬 스택만 탄다.
 */

const service = createServiceClient();

const anon = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

const USER_A = '00000000-0000-4000-9000-00000000000a';
const USER_B = '00000000-0000-4000-9000-00000000000b';
const DRAFT_ID = '00000000-0000-4000-8000-0000000dfaf7';

/**
 * 정책 수준 검사. 세션 대신 JWT 클레임을 넣는다.
 *
 * **stderr 까지 합쳐 돌려준다.** RLS 거부와 권한 거부는 stderr 로 나오므로
 * stdout 만 보면 "막혔다" 를 "아무 일도 없었다" 로 읽게 된다.
 */
function asUser(userId: string, sql: string): string {
  const script = `
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';
  ${sql}
commit;`;

  const result = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_TechNow', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A'],
    { input: script, encoding: 'utf8' },
  );

  return `${result.stdout}\n${result.stderr}`;
}

/**
 * 출력에서 행 수를 꺼낸다.
 *
 * psql 은 BEGIN/SET/COMMIT 같은 명령 태그도 같이 찍는다. 마지막 줄을 집으면
 * 'COMMIT' 을 숫자로 읽는다 — 처음에 그렇게 만들어 8개가 NaN 으로 깨졌다.
 */
function countFrom(output: string): number {
  const numeric = output.split('\n').map((line) => line.trim()).filter((line) => /^\d+$/.test(line));

  expect(numeric.length, `숫자 출력이 없다: ${output.slice(0, 200)}`).toBeGreaterThan(0);
  return Number(numeric[0]);
}

/**
 * 테스트 사용자를 만든다 (비밀번호 없음).
 *
 * `supabase db reset` 이 auth.users 를 비우므로 테스트가 스스로 준비해야 한다 —
 * 전에는 없는 상태에서 스크랩 insert 가 조용히 실패해 엉뚱한 검사가 깨졌다.
 *
 * **로그인할 수 있는 계정이 아니다.** 이 검사는 정책을 보는 것이고 로그인을
 * 하지 않는다. FK 를 채울 행만 있으면 된다.
 */
function ensureTestUsers(): void {
  const values = [USER_A, USER_B]
    .map(
      (id) =>
        `('${id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'isolation-${id.slice(-1)}@local.test', now(), now())`,
    )
    .join(',');

  const result = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_TechNow', 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A'],
    {
      input: `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
              values ${values} on conflict (id) do nothing;`,
      encoding: 'utf8',
    },
  );

  expect(result.stderr, `테스트 사용자 생성 실패: ${result.stderr}`).not.toContain('ERROR');
}

beforeAll(async () => {
  ensureTestUsers();

  // 발행 전 기사 하나. 익명에게 절대 보이면 안 되는 것의 대표다
  await service.from('articles').upsert({
    id: DRAFT_ID,
    slug: 'isolation-draft-should-never-be-public',
    category: 'ai-computing',
    title: 'DRAFT — must not leak',
    one_line_summary: 'If you can read this as anon, the gate is broken.',
    body: { sections: [{ heading: 'h', paragraphs: ['p'], sources: [1] }] },
    topic_hash: 'isolation-test',
    status: 'draft',
  });

  // A 가 발행된 기사 하나를 스크랩한 상태를 만든다
  const { data: published } = await service
    .from('articles')
    .select('id')
    .eq('status', 'published')
    .limit(1);

  expect(published?.length, '발행된 기사가 없어 스크랩 격리를 볼 수 없다').toBeGreaterThan(0);

  await service.from('scraps').delete().in('user_id', [USER_A, USER_B]);

  // 조용히 실패하면 아래 검사들이 엉뚱한 이유로 깨진다
  const { error } = await service
    .from('scraps')
    .insert({ user_id: USER_A, article_id: published![0]!.id });
  expect(error, `스크랩 준비 실패: ${error?.message}`).toBeNull();
});

afterAll(async () => {
  await service.from('scraps').delete().in('user_id', [USER_A, USER_B]);
  await service.from('articles').delete().eq('id', DRAFT_ID);
});

describe('익명 접근 (7.6a)', () => {
  it('발행된 기사는 읽을 수 있다', async () => {
    const { data, error } = await anon.from('articles').select('id, status');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    // 이게 이 테스트의 핵심이다
    expect(data!.every((a) => a.status === 'published'), '발행 전 기사가 보인다').toBe(true);
  });

  it('발행 전 기사는 id 로 찔러도 안 보인다', async () => {
    // 없는 것과 구분되지 않아야 한다 (D-02)
    const { data } = await anon.from('articles').select('id').eq('id', DRAFT_ID).maybeSingle();

    expect(data).toBeNull();
  });

  it('아카이브 월 집계도 발행된 기사만 센다 (7.8)', async () => {
    // article_months() 가 security definer 였다면 draft 까지 세어져
    // 편수만 보고도 발행 전 기사가 몇 건인지 알 수 있다
    const { data, error } = await anon.rpc('article_months');
    expect(error).toBeNull();

    const counted = (data ?? []).reduce((sum, row) => sum + Number(row.article_count), 0);
    const { data: visible } = await anon.from('articles').select('id');

    expect(counted, '집계가 익명에게 보이는 기사 수와 다르다').toBe(visible!.length);
  });

  it('발행된 기사의 출처와 번역만 보인다', async () => {
    const { data: sources } = await anon.from('article_sources').select('article_id');
    const { data: translations } = await anon.from('article_translations').select('article_id');

    expect(sources?.some((s) => s.article_id === DRAFT_ID)).toBe(false);
    expect(translations?.some((t) => t.article_id === DRAFT_ID)).toBe(false);
  });

  for (const table of [
    'scraps',
    'profiles',
    'monthly_summaries',
    'pipeline_runs',
    'run_topics',
    'source_texts',
    'seen_feed_items',
    'article_feedback',
  ] as const) {
    it(`${table} 는 익명에게 열리지 않는다`, async () => {
      const { data, error } = await anon.from(table).select('*').limit(5);

      // 권한이 없거나(에러) 정책이 0행을 돌려주거나 — 둘 다 통과다.
      // 새는 경우만 실패다
      const leaked = !error && (data?.length ?? 0) > 0;
      expect(leaked, `${table} 가 익명에게 ${data?.length}행 노출됐다`).toBe(false);
    });
  }
});

describe('사용자 간 격리 (7.6)', () => {
  it('본인 스크랩은 보인다', () => {
    expect(countFrom(asUser(USER_A, 'select count(*) from scraps;'))).toBe(1);
  });

  it('남의 스크랩은 보이지 않는다', () => {
    expect(countFrom(asUser(USER_B, 'select count(*) from scraps;')), 'B 가 A 의 스크랩을 봤다').toBe(0);
  });

  it('남의 스크랩을 지울 수 없다', () => {
    asUser(USER_B, 'delete from scraps;');

    expect(
      countFrom(asUser(USER_A, 'select count(*) from scraps;')),
      'B 가 A 의 스크랩을 지웠다',
    ).toBe(1);
  });

  it('남의 이름으로 스크랩을 만들 수 없다', () => {
    // 서버 액션이 user_id 를 클라이언트에서 받지 않지만, 받더라도 DB 가 막아야 한다
    const output = asUser(
      USER_B,
      `savepoint s;
       insert into scraps (user_id, article_id)
         select '${USER_A}', id from articles where status='published' limit 1;
       rollback to s;`,
    );

    expect(output).toContain('row-level security');
  });

  it('남의 프로필은 보이지 않는다', () => {
    expect(countFrom(asUser(USER_B, `select count(*) from profiles where id = '${USER_A}';`))).toBe(0);
  });

  it('남의 월간 요약은 보이지 않는다', () => {
    expect(
      countFrom(asUser(USER_B, `select count(*) from monthly_summaries where user_id = '${USER_A}';`)),
    ).toBe(0);
  });

  it('로그인해도 파이프라인 테이블은 못 읽는다', () => {
    // 로그인이 내부 로그를 여는 열쇠가 되면 안 된다
    const output = asUser(USER_B, 'savepoint s; select count(*) from pipeline_runs; rollback to s;');
    expect(output).toContain('permission denied');
  });

  it('로그인해도 발행 전 기사는 못 읽는다', () => {
    expect(countFrom(asUser(USER_B, `select count(*) from articles where id = '${DRAFT_ID}';`))).toBe(0);
  });
});
