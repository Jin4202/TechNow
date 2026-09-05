import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * 실제 네트워크를 타는 검증용 설정. 기본 테스트 실행(CI)에는 포함되지 않는다.
 * 실행: pnpm feeds:live
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/live/**/*.live.ts'],
    setupFiles: ['tests/live/setup.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
