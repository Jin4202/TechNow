import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * 로컬·CI 의 Node 버전과 Trigger.dev 클라우드 런타임이 갈라지지 않게 한다 (D-17).
 *
 * 이 둘이 어긋나면 로컬과 CI 는 전부 통과하는데 배포된 파이프라인만 죽는다.
 * 실제로 그렇게 한 번 터졌다 — supabase-js 가 Node 20 에서
 * "native WebSocket not found" 를 던진다.
 */
describe('Node 버전 일치', () => {
  const nvmrc = readFileSync('.nvmrc', 'utf8').trim();
  const triggerConfig = readFileSync('trigger.config.ts', 'utf8');
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    engines?: { node?: string };
  };

  it('.nvmrc 는 메이저 버전만 적는다', () => {
    expect(nvmrc).toMatch(/^\d+$/);
  });

  it('trigger.config.ts 의 runtime 이 .nvmrc 와 같은 메이저다', () => {
    const match = /runtime:\s*'node-(\d+)'/.exec(triggerConfig);
    expect(match, "runtime 은 'node-<major>' 여야 한다. 기본값 'node' 는 Node 20 이다").not.toBeNull();
    expect(match![1]).toBe(nvmrc);
  });

  it('package.json engines 가 .nvmrc 와 같은 메이저를 요구한다', () => {
    expect(packageJson.engines?.node).toBe(`>=${nvmrc}.0.0`);
  });

  it('supabase-js 가 요구하는 최소 버전(22) 이상이다', () => {
    // Node 20 이하는 WebSocket 이 플래그 뒤에 있어 서비스 클라이언트가 죽는다
    expect(Number(nvmrc)).toBeGreaterThanOrEqual(22);
  });
});
