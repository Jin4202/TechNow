/**
 * 사이트 자체에 대한 값 (로드맵 7.1, 7.1a).
 *
 * 환경변수가 아니라 config 인 이유: 도메인은 환경마다 달라지는 값이 아니라
 * 프로젝트가 정한 값이고, canonical 은 로컬에서도 프로덕션 주소를 가리켜야 한다.
 * 환경변수로 빼면 Vercel 과 Trigger.dev 양쪽에 같은 값을 심어야 하고
 * 한쪽을 빠뜨리면 조용히 틀린다.
 */

/**
 * 사이트의 원점(origin). 경로를 붙이지 않는다.
 *
 * **2차 공개에서 커스텀 도메인으로 바뀐다.** 그때 고칠 곳이 여기 하나가 되도록
 * `metadataBase` 와 크롤러 User-Agent(`http.ts`)가 전부 이 값을 읽는다.
 */
export const SITE_URL = 'https://technow-seven.vercel.app';

/**
 * 공개 문의 주소. **없으면 문의 항목 자체를 렌더하지 않는다.**
 *
 * `null` 인 채로 두는 것은 의도적이다 — 가짜 주소(`hello@example.com` 같은)를
 * 넣어두면 그대로 공개될 위험이 있고, 빈 문자열을 넣으면 링크가 깨진 채 나간다.
 * 값이 없을 때 아무것도 안 보이는 쪽이 안전하다.
 *
 * 게이트를 열기 전에 채운다 (로드맵 7.7 점검표).
 */
export const CONTACT_EMAIL: string | null = null;
