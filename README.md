# TechNow

과학·기술 뉴스 자동 발행 웹앱.

큐레이션된 RSS 피드에서 매일 주목할 만한 주제를 발굴하고, 각 주제를 3~5개 출처로 조사해 원본 영문 기사를 작성한다. 근거 검증을 통과한 기사에 한국어 번역과 커버 이미지를 붙여 매일 07:00 America/Los_Angeles에 일괄 발행한다. 사용자는 기사를 스크랩하고 월간 요약을 받는다.

## 문서

| 문서 | 내용 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 작업 규칙, 프로젝트 구조, 문서 라우팅 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phase별 태스크와 완료 기준. **현재 위치는 여기서 확인** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 런타임 경계, 파이프라인, 데이터 모델, RLS |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 기획서 이후의 결정 (D-01~) |
| [docs/MASTER_PLAN.md](docs/MASTER_PLAN.md) | 기획 원본 |

## 스택

TypeScript · Next.js 16 (App Router) · Tailwind CSS 4 · Supabase (Postgres/Auth/Storage/RLS) · Trigger.dev (배치) · Claude API · Brave Search · Flux schnell

## 개발

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm typecheck
pnpm lint
pnpm test
```

로컬 Supabase 스택:

```bash
supabase start
supabase status
```

환경변수는 `.env.example`을 `.env.local`로 복사해 채운다. **앱용 키와 파이프라인 전용 키는 절대 섞지 않는다** — `CLAUDE.md` §2.1 참고.
