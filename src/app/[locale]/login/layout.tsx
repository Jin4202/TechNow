import { notFound } from 'next/navigation';

import { features } from '@/config/features';

/**
 * 로그인 라우트의 잠금 (로드맵 7.0c).
 *
 * `page.tsx` 가 클라이언트 컴포넌트라 서버 환경변수를 읽을 수 없다. 판정을
 * 서버 레이아웃으로 올려서 폼 자체가 렌더되지 않게 한다.
 *
 * **링크만 감추고 라우트를 열어두지 않는 이유**: 주소를 직접 치면 확인 메일 없이
 * 가입이 되고, 그렇게 만들어진 계정은 2차에서 확인을 켤 때 애매한 상태가 된다.
 */
export default function LoginLayout({ children }: LayoutProps<'/[locale]/login'>) {
  if (!features.accounts) notFound();

  return children;
}
