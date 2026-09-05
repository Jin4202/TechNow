import { readFileSync } from 'node:fs';

/** 로컬 검증용 테스트에 .env.local 을 주입한다 */
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    // 빈 값은 건너뛴다. `??=` 는 빈 문자열도 "설정됨" 으로 보므로
    // .env.local 에 같은 키가 두 번 있으면 빈 쪽이 이겨버린다
    if (match && match[2]) process.env[match[1]!] ??= match[2];
  }
} catch {
  // .env.local 이 없으면 테스트가 알아서 실패한다
}
