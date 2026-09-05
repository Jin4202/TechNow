import { readFileSync } from 'node:fs';

/** 로컬 검증용 테스트에 .env.local 을 주입한다 */
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) process.env[match[1]!] ??= match[2]!;
  }
} catch {
  // .env.local 이 없으면 테스트가 알아서 실패한다
}
