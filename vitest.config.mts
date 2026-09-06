import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // .tsx 도 받는다 — 렌더 결과를 확인하는 컴포넌트 테스트가 있다 (6.7).
    // DOM 없이 renderToStaticMarkup 으로 문자열만 본다
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
