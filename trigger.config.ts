import { defineConfig } from '@trigger.dev/sdk';

/**
 * Trigger.dev 설정.
 *
 * 파이프라인은 Vercel이 아니라 여기서 돈다. 연구 단계가 단일 호출 제한을
 * 넘기 때문이다 (MASTER_PLAN §3).
 *
 * project ref 는 비밀이 아니다. 프로젝트 식별자일 뿐이고, 실제 권한은
 * TRIGGER_SECRET_KEY 가 쥔다 (Trigger.dev 환경변수에만 둔다).
 */
export default defineConfig({
  project: 'proj_biyzhkrdvogkczkpqepd',

  // .nvmrc 와 같은 메이저 버전이어야 한다 (D-17).
  // 기본값 'node' 는 Node 20 이고, supabase-js 가 거기서
  // "native WebSocket not found" 로 죽는다.
  // tests/runtime-version.test.ts 가 둘의 일치를 지킨다
  runtime: 'node-22',
  logLevel: 'log',

  // 조사 단계는 검색 + 페이지 fetch 여러 번을 돈다. 넉넉히 잡는다
  maxDuration: 600,

  retries: {
    // 개발 중에는 실패를 즉시 보고 싶다
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 30_000,
      factor: 2,
      randomize: true,
    },
  },

  dirs: ['./src/trigger'],
});
