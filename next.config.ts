import createNextIntlPlugin from 'next-intl/plugin';

import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * 커버 이미지는 Supabase Storage 의 `covers` 버킷에서만 온다 (5.3, 5.6).
 *
 * next/image 는 원격 호스트를 화이트리스트로 막는다. 우리 프로젝트의 Storage
 * 경로만 연다 — 넓게 열면 남의 이미지를 우리 도메인으로 최적화해 서빙하게 된다.
 *
 * 로컬 스택은 http 127.0.0.1 이고 배포본은 https 다. 둘 다 `NEXT_PUBLIC_SUPABASE_URL`
 * 에서 읽는다 — 호스트를 상수로 박으면 환경마다 이미지가 조용히 깨진다.
 */
const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321');

const nextConfig: NextConfig = {
  images: {
    // Next 16 은 사설 IP 의 이미지를 최적화하지 않는다 (SSRF 방어).
    // 로컬 Supabase 는 127.0.0.1 이라 여기 걸린다 — **개발에서만** 연다.
    // 프로덕션 Storage 는 공개 https 호스트라 이 예외가 필요 없고,
    // 켜둔 채로 배포하면 우리 서버가 내부망 이미지를 가져다 주는 통로가 된다
    dangerouslyAllowLocalIP: process.env.NODE_ENV === 'development',
    remotePatterns: [
      {
        protocol: supabase.protocol.replace(':', '') as 'http' | 'https',
        hostname: supabase.hostname,
        port: supabase.port,
        pathname: '/storage/v1/object/public/covers/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
