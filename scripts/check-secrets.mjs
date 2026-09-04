#!/usr/bin/env node
/**
 * 파이프라인 전용 시크릿이 Next.js 앱 코드로 새지 않았는지 검사한다.
 *
 * CLAUDE.md §2.1 을 실행 가능한 검사로 바꾼 것.
 * service_role 키가 앱 번들에 들어가면 anon 키 + RLS(D-02)로 세운 방어선이
 * 통째로 무의미해지는데, 문서에만 적힌 규칙은 언젠가 깨진다.
 *
 * 사용: node scripts/check-secrets.mjs
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** 앱 번들에 들어갈 수 있는 경로 */
const SCANNED_DIRS = ['src/app', 'src/components', 'src/messages'];

/** 이 문자열이 위 경로에 나타나면 위반 */
const FORBIDDEN = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SERVICE_ROLE',
  'ANTHROPIC_API_KEY',
  'BRAVE_API_KEY',
  'FAL_KEY',
  'TRIGGER_SECRET_KEY',
  // 파이프라인 전용 env 접근자. 앱에서 부르면 안 된다
  'getPipelineEnv',
];

const SCANNED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json']);

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // 아직 없는 디렉터리는 통과
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (SCANNED_EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

const violations = [];

for (const dir of SCANNED_DIRS) {
  for (const file of await walk(dir)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const needle of FORBIDDEN) {
        if (line.includes(needle)) {
          violations.push({ file, line: i + 1, needle, text: line.trim() });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error('\n파이프라인 전용 시크릿이 앱 코드에서 발견되었습니다 (CLAUDE.md §2.1):\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.needle}]`);
    console.error(`    ${v.text}\n`);
  }
  console.error('이 키들은 Trigger.dev 태스크 전용입니다. 앱은 anon 키 + RLS로만 DB에 접근합니다.\n');
  process.exit(1);
}

console.log(`시크릿 유출 검사 통과 (${SCANNED_DIRS.join(', ')})`);
