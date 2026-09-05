# DECISIONS

`MASTER_PLAN.md` §9의 연장. 기획서에 없던 판단을 내렸을 때 여기에 한 줄씩 추가한다.
형식: 결정 / 이유 / 날짜. 뒤집힌 결정은 지우지 말고 취소선으로 남긴다.

---

## 2026-09-04 — 구조 리뷰 확정분 (D-01 ~ D-09)

`ARCHITECTURE.md` 리뷰에서 제기된 9개 항목을 확정했다.

### D-01. `seen_feed_items`에 처리 상태를 둔다

RSS 항목을 **처음 볼 때** `status='pending'`으로 기록한다. 선정 단계(§2.1 6단계)까지 끝나야 `status='processed'`로 갱신한다. 다음 날 런은 `pending` 항목을 다시 후보로 본다. 며칠 지난 `pending`은 폐기한다(기본 3일, config `pendingTtlDays`).

**이유**: 기록 즉시 dedup 처리하면 그룹핑·채점 중 런이 죽었을 때 그 항목들이 영구 유실된다. "실패한 런이 다음 날에 영향을 주면 안 된다"는 §2.1 제약과 충돌했다.
**주의**: 임계값 미달로 **탈락한** 항목도 `processed`다. 탈락은 정상적인 처리 완료이며, 매일 재채점하면 안 된다.

### D-02. 모든 테이블에 RLS, 예외 없음

`MASTER_PLAN` §1.1의 "사용자 소유 테이블에 RLS"를 **"모든 테이블에 RLS, 예외 없음"** 으로 원칙 변경. `articles`, `article_translations`, `article_sources`의 select 정책은 `status='published'`인 행만 허용한다. 파이프라인 쓰기는 anon key가 아닌 service_role key로 수행한다.

**이유**: anon key는 브라우저에 공개된다. `articles`에 RLS가 없으면 draft 기사 전문이 그대로 조회된다.

### D-03. 기사 본문은 JSONB 섹션 배열

`articles.body`를 텍스트에서 JSONB 섹션 배열로 변경한다(소제목, 문단, 참조 출처 번호 목록). `article_translations.body`도 동일 구조. `article_sources`에 `ordinal` 컬럼 추가.
"번역이 구조를 바꾸지 않는다"는 제약을 **섹션 수 비교 + 출처 번호 배열 비교**로 코드화한다.

**이유**: §2.2가 요구하는 섹션별 출처 표기를 담을 자리가 스키마에 없었다.

### D-04. 스케줄은 3개, 발행은 분리 유지

~~Trigger.dev 무료 티어 스케줄 한도는 2개~~ → **실제 한도는 10개.** 기획서의 "두 개" 표현이 틀렸다.
01:00 파이프라인과 07:00 발행을 `wait.until`로 합치지 않고 **별도 스케줄로 유지**한다. 월간 요약까지 3개.

**이유**: 장애 격리. 01:00 런이 걸려 있어도 07:00 발행은 독립적으로 실행되어 `ready` 상태 기사를 내보낸다. 한 런에 6시간 대기를 묶으면 파이프라인 장애가 발행 장애로 번진다.

### D-05. 출처 본문은 `source_texts` 테이블

Storage가 아니라 DB 테이블을 쓴다: `source_texts(article_id | run_id, url, extracted_text, expires_at)`. 매일 런 종료 시 만료분을 삭제하는 정리 태스크를 둔다.

**이유**: 단계 간 전달이 경로가 아니라 쿼리로 끝난다. 트랜잭션·조인·RLS가 그대로 적용되고, Storage 수명주기 관리보다 단순하다. "가져온 페이지를 영구 저장하지 않는다"는 §4 원칙은 `expires_at` + 정리 태스크로 지킨다.

### D-06. 출처 본문을 읽는 모든 단계를 Sonnet으로 통일

작성 / 클레임 추출 / 검증 / 재작성 — 출처 본문을 프롬프트에 싣는 단계는 전부 `claude-sonnet-5`로 통일해 **prompt cache를 공유**한다. 그룹핑·채점은 Haiku, 번역·월간 요약은 Sonnet(출처 본문 미사용)으로 유지한다.
출처 본문 블록은 **모든 단계에서 동일한 순서·동일한 형식으로 프롬프트 앞부분에** 배치한다.

**이유**: 클레임 추출을 Haiku로 두면 20k 토큰짜리 출처 블록을 캐시 없이 매번 새로 보낸다. Sonnet 캐시 읽기가 Haiku 신규 입력보다 싸다. 모델을 섞는 순간 캐시가 쪼개진다.
**변경점**: `MASTER_PLAN` §3의 모델 배정 중 "클레임 추출 = Haiku"를 뒤집는다.

### D-07. 비용을 고정비/변동비로 분리

`pipeline_runs`에 `cost_fixed`(발굴~선정)와 `cost_variable`(조사~이미지, 기사별)를 분리한다.
예산 계산식: **고정비 × 30일 + 변동비 × 기사 수 ≤ 20 USD/월**. 기사당 0.20 USD 목표는 **변동비에만** 적용한다.

**이유**: 발굴·그룹핑·채점은 기사가 0개인 날에도 발생한다. 전체 비용을 기사 수로 나누면 조용한 날의 단가가 왜곡되어 잘못된 최적화를 하게 된다.

### D-08. locale은 URL 경로

`/[locale]/articles/[slug]` 구조(next-intl 표준 패턴). `profiles.locale`은 **언어 없는 경로로 진입했을 때의 리다이렉트 기본값으로만** 사용한다. 두 locale 모두 `hreflang` 태그를 낸다.

**이유**: 계정 설정만으로 콘텐츠 언어를 바꾸면 같은 URL이 두 언어를 서빙하게 되어 SSR 캐싱과 검색 노출이 깨진다.

### D-09. 임계 규칙 표기 통일

"어느 축도 2 이하가 아님"을 **"모든 축이 3 이상"** 으로 문서·코드 전반에서 통일한다. 규칙 전체는 `총점 ≥ 10 && min(axis) ≥ 3`.

**이유**: 부정형 이중 표현이 구현 시 off-by-one을 유발한다.

---

## 2026-09-04 — Phase 0 실행 중 확정 (D-10 ~ D-14)

### D-10. 패키지 매니저는 pnpm

로컬에 이미 pnpm 10.34.3이 있고 `create-next-app --use-pnpm`으로 스캐폴딩했다. CI(`pnpm/action-setup`)와 Vercel 모두 `pnpm-lock.yaml`로 자동 인식한다.

### D-11. 접근 게이트는 Next 미들웨어 basic auth

Vercel Deployment Protection 대신 `src/proxy.ts`에서 basic auth를 구현한다.

**이유**: Vercel의 비밀번호 보호는 유료 플랜 기능이고, 무료 플랜의 Vercel Authentication은 계정 소유자만 들어갈 수 있어 남에게 보여줄 수 없다. 미들웨어 방식은 무료이고 자격증명을 공유할 수 있다.
**설계**: `GATE_USER`/`GATE_PASSWORD`가 비어 있으면 **통과가 아니라 503으로 차단**한다(fail closed). 설정 누락이 게이트 해제로 이어지면 안 된다. 개발 환경만 예외로 통과시킨다.
**제거 시점**: 로드맵 `7.7`.

### D-12. Supabase는 로컬 스택 + 클라우드 병행

`supabase init` + `supabase start`로 로컬 Docker 스택을 쓰고, 마이그레이션을 로컬에서 검증한 뒤 클라우드에 push한다.

**이유**: RLS 정책(D-02)은 실험 횟수가 많고 되돌리기가 잦다. 실제 프로젝트에 직접 실험하면 `1.1a`와 `7.6a`의 반복 비용이 커진다.

### D-13. `[locale]` 재배치는 Phase 0이 아니라 4.0에서

D-08의 `/[locale]/articles/[slug]` 구조를 Phase 0에서 미리 만들지 않고 `src/app/`을 평면으로 둔다.

**이유**: next-intl 없이 `[locale]` 세그먼트만 만들면 라우팅이 깨진다. Phase 1의 기사 목록(1.12)은 영문 UI라 평면 경로로 충분하고, 4.0에서 파일 몇 개를 옮기는 비용이 더 싸다.

### D-14. 커밋 메시지에 Claude 표기를 넣지 않는다

`Co-Authored-By: Claude ...` 트레일러와 `🤖 Generated with ...` 문구를 쓰지 않는다. 커밋은 `feat(0.2): ...` 처럼 로드맵 태스크 번호로 시작한다. `CLAUDE.md` §4에 규칙으로 반영했다.

---

## 2026-09-04 — Phase 1 (D-15 ~ D-16)

### D-15. 카테고리 7종의 한국어 명칭과 식별자 확정

| 식별자 (DB enum · URL) | English | 한국어 |
|---|---|---|
| `ai-computing` | AI & Computing | AI·컴퓨팅 |
| `space-astronomy` | Space & Astronomy | 우주·천문 |
| `health-biotech` | Health & Biotech | 건강·바이오 |
| `climate-energy` | Climate & Energy | 기후·에너지 |
| `physics-materials` | Physics & Materials | 물리·소재 |
| `robotics-hardware` | Robotics & Hardware | 로봇·하드웨어 |
| `industry-policy` | Tech Industry & Policy | 산업·정책 |

**식별자 표기**: kebab-case 하나로 통일해 DB enum 값과 URL 슬러그(로드맵 7.3의 카테고리 필터)에 그대로 쓴다. snake_case DB 값과 kebab URL 슬러그를 따로 두면 매핑 테이블이 하나 더 생긴다.

**한국어 명칭**: 가운뎃점으로 두 낱말을 잇는 짧은 형태로 통일했다. 목록 페이지의 카테고리 칩과 월간 요약의 소제목에 들어가므로 길면 줄바꿈이 생긴다.

**설명문**: `src/config/categories.ts`의 `description`은 나중에 분류 프롬프트에 그대로 들어간다. 카테고리 간 경계가 드러나게 썼다. 늘리지 않는다 — 하루 3개짜리 사이트에서 카테고리가 더 생기면 빈 섹션만 늘어난다.

### D-16. RSS 피드 선정 기준 (실제 목록은 1.5)

- **영어 피드만.** 한국어는 번역으로만 만든다 (기획서 §0)
- **3~5개**, 7개 카테고리를 모두 커버. 카테고리당 최소 1개 경로가 있어야 한다
- 과학과 기술의 비중을 대략 균등하게
- **1차 출처 성격의 피드(기관·저널 발표)와 종합 과학·기술 매체를 섞는다.** 전자만 쓰면 산업·정책이 비고, 후자만 쓰면 Tier 1 확보(3.10)가 어려워진다
- **페이월 매체는 제외한다.** RSS 자체는 주제 발굴용이라 본문이 필요 없지만, 근접 재채점(2.5)에서 트리거 페이지를 fetch하므로 막히면 그 토픽만 불리해진다
- 피드가 죽어도 다른 피드가 같은 카테고리를 덮도록, 한 카테고리를 단일 피드에만 의존시키지 않는다

### D-16 결과. 선정된 피드 5개 (1.5 완료)

| name | URL | 커버 | 1회 수집량 |
|---|---|---|---|
| `phys-org` | phys.org/rss-feed/ | 우주·물리·기후·바이오·AI | 30 |
| `science-daily` | sciencedaily.com/rss/all.xml | 바이오·기후·물리·우주 | 60 |
| `ars-technica` | feeds.arstechnica.com/arstechnica/index | AI·산업정책·하드웨어·우주 | 20 |
| `ieee-spectrum` | spectrum.ieee.org/feeds/feed.rss | 로봇·AI·에너지·산업정책 | 30 |
| `nasa` | nasa.gov/news-release/feed/ | 우주 (1차 출처) | 10 |

합계 약 150건/일. Phase 2 완료 조건의 "원시 항목 100건 규모"와 맞는다.
7개 카테고리 전부 **2개 이상**의 피드가 커버한다 (`tests/feeds.test.ts`가 강제).

**수집 시 주의**
- **Phys.org 는 기본 User-Agent 를 거부한다** (HTTP 400). 식별 가능한 UA 필수.
  `FEED_USER_AGENT` 상수를 쓴다
- 후보였던 EurekAlert 의 RSS 경로는 404였다. 다시 넣으려면 경로를 새로 찾아야 한다
- Nature(`nature.com/nature.rss`)는 **RSS 1.0(RDF)** 이라 `.//item` 으로 파싱되지 않는다.
  지금 목록에는 RDF 피드가 없으므로 파서는 RSS 2.0 과 Atom 만 다루면 된다.
  Nature 를 추가하려면 파서에 RDF 처리를 먼저 넣어야 한다

### D-17. Node 22 LTS 를 쓴다

`.nvmrc` = 22, `package.json` engines `>=22.0.0`, CI 는 `node-version-file: .nvmrc`.

**이유**: `@supabase/supabase-js` 가 Node 20 이하를 지원 중단 예정이라고 경고하고,
실제로 **Node 20 에서는 서비스 클라이언트 생성이 실패한다** — "native WebSocket not found".
Node 20 은 `WebSocket` 이 `--experimental-websocket` 플래그 뒤에 있고 22 부터 기본 제공된다.
`ws` 폴리필로 덮을 수도 있지만 지원 중단을 미루는 것뿐이고, Vercel·Trigger.dev·GitHub Actions
모두 Node 22 를 지원한다.

**주의**: Next.js 서버(`@supabase/ssr`)는 Node 20 에서도 동작했다. 실패하는 건 파이프라인이
쓰는 `createServiceClient` 쪽이다. 로컬에서 `nvm use` 를 빠뜨리면 파이프라인 테스트만 깨진다.

**Node 버전을 정하는 곳이 세 군데다.** `.nvmrc` 는 로컬과 CI 만 커버한다.
Trigger.dev 클라우드 런타임은 `trigger.config.ts` 의 `runtime` 이 정하며,
기본값 `'node'` 는 Node 20 이다. 처음에 `.nvmrc` 만 올렸다가 **로컬·CI 는 전부 통과하는데
배포된 파이프라인만 죽는** 상황을 겪었다. `runtime: 'node-22'` 로 맞췄고,
`tests/runtime-version.test.ts` 가 `.nvmrc` / `engines` / `runtime` 세 값의 일치를 지킨다.

### D-18. 권한을 대시보드 토글이 아니라 마이그레이션에 박는다

Supabase 프로젝트 설정:

| 항목 | 값 |
|---|---|
| Enable Data API | ON (supabase-js 를 쓰므로 필수) |
| Automatically expose new tables | **OFF** |
| Enable automatic RLS | ON |

다만 **이 토글에 보안을 의존하지 않는다.** 로컬 스택에는 같은 토글이 없어서
로컬과 운영이 갈라지고, 그런 차이는 운영에서만 터진다. 같은 효과를
`20260905040000_explicit_grants.sql` 에 넣어 양쪽이 동일하게 동작하게 했다:

- `revoke all ... from anon, authenticated` 후 필요한 것만 `grant`
- `alter default privileges ... revoke all` — 새 테이블은 기본적으로 권한 없음
- `CREATE TABLE` 이벤트 트리거로 새 테이블에 RLS 강제

**왜 기본 grant 로는 부족했나**: Supabase 기본값은 anon 에게 `TRUNCATE` 와
`REFERENCES` 까지 준다. **TRUNCATE 는 RLS 로 걸러지지 않는다** — PostgREST 가
그 동작을 노출하지 않을 뿐이다. `revoke insert, update, delete` 만으로는 남는다.

**권한 모델**: RLS 정책이 "어느 행"을, grant 가 "어느 동작"을 정한다. 둘 다
통과해야 접근된다. 새 테이블을 추가하면 explicit_grants 마이그레이션에
grant 를 더해야 앱에서 보인다 — 잊으면 노출이 아니라 미표시로 실패한다.

최종 권한:

| 테이블 | anon | authenticated |
|---|---|---|
| articles / article_sources / article_translations | select | select |
| profiles | — | select, update |
| scraps | — | select, insert, delete |
| monthly_summaries | — | select |
| seen_feed_items / source_texts / pipeline_runs | — | — |

`scraps` 에 update 를 주지 않은 것은 의도적이다. 수정할 필드가 없다.

**service_role 도 명시적으로 부여해야 한다** (`20260905050000_service_role_grants.sql`).
처음에는 anon/authenticated 만 다루고 service_role 은 Supabase 기본값에 기댔는데,
"Automatically expose new tables" 를 끈 클라우드에서는 service_role 도 아무 권한을
받지 못한다. 로컬 라이브 테스트는 전부 통과하는데 배포된 파이프라인만
`permission denied for table pipeline_runs` 로 죽었다.

service_role 은 RLS 를 우회하지만(BYPASSRLS) **테이블 grant 는 따로 필요하다.**
anon/authenticated 와 달리 화이트리스트로 관리하지 않고 `grant all on all tables`
+ default privileges 로 준다. 파이프라인은 모든 테이블에 접근해야 한다.

---

## 참고 — Next 16 변경점 (결정이 아니라 사실)

`middleware.ts` 파일 규약이 **`proxy.ts`로 개명**되었고, export 이름도 `middleware` → `proxy`다. `create-next-app`이 생성한 `AGENTS.md`가 "이 Next는 학습 데이터와 다르다"고 경고하며 `node_modules/next/dist/docs/`를 읽으라고 안내한다. Next 관련 작업 전에 그 문서를 확인할 것 (`CLAUDE.md` §2.9).

`pnpm typecheck`는 `next typegen && tsc --noEmit`이다. Next 16이 `LayoutProps` 같은 라우트 타입을 생성하므로 typegen 없이 `tsc`만 돌리면 실패한다.

---

## 미기록 (해당 태스크에서 확인 후 추가할 것)

| 항목 | 확인 태스크 |
|---|---|
| Brave Search 무료 티어 월 쿼리 한도와 예상 사용량 | 3.2a |
| prompt cache TTL과 파이프라인 체인 소요 시간의 관계 | 3.8a |
| Flux schnell vs Imagen 4 Fast 비교 결과 | 5.1 |
| 최종 앱 이름과 도메인 | 7.0 |
