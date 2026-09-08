# CLAUDE.md

**TechNow** — 과학·기술 뉴스 자동 발행 웹앱.
RSS로 주제를 발굴 → 3~5개 출처를 조사 → 원본 영문 기사 작성 → 근거 검증 → 한국어 번역 + 커버 이미지 → 매일 07:00 America/Los_Angeles 일괄 발행. 사용자는 기사를 스크랩하고 월간 요약을 받는다.

이 파일은 **작업 규칙**이다. 기획 원본은 `docs/MASTER_PLAN.md`, 구조 설명은 `docs/ARCHITECTURE.md`에 있다. 여기에 중복해서 옮겨 적지 말 것.

---

## 1. 문서 라우팅 — 언제 무엇을 읽나

| 상황 | 읽을 문서 |
|---|---|
| 지금 무슨 작업을 해야 하는지, 다음 태스크가 뭔지 | `docs/ROADMAP.md` |
| 모듈 경계, 데이터 흐름, 스키마, 어디에 코드를 둘지 | `docs/ARCHITECTURE.md` |
| "왜 이렇게 정했나"가 궁금할 때, 기획 의도를 확인할 때 | `docs/MASTER_PLAN.md` (§9 결정 로그) |
| 기획서와 구조가 다른 이유 (RLS·body 포맷·모델 배정 등) | `docs/DECISIONS.md` (D-01~D-09) |
| 새 결정을 내렸을 때 기록할 곳 | `docs/DECISIONS.md` |
| 카테고리 목록, config 기본값, 피드 목록 | `docs/DECISIONS.md` |
| 중요도 점수(novelty/impact/interest) 프롬프트를 만들거나 고칠 때 | `docs/RUBRIC.md` |
| 기사 작성·번역 프롬프트를 만들거나 고칠 때 | `docs/STYLE_GUIDE.md` |
| Claude API 파라미터, 모델 ID, 가격, 캐싱, structured output | `claude-api` skill (기억에 의존하지 말 것) |

**아직 없는 문서는 해당 로드맵 태스크(1.0 / 2.0 / 3.1)에서 만든다.** 없다고 그냥 진행하지 말고, 필요하면 먼저 만들 것.

문서를 바꿔야 하는 경우:
- 스키마·모듈 경계·데이터 흐름이 바뀌면 → `docs/ARCHITECTURE.md` 갱신
- 태스크를 끝냈으면 → `docs/ROADMAP.md`의 체크박스와 "현재 위치" 갱신
- 기획서에 없던 판단을 했으면 → `docs/DECISIONS.md`에 한 줄 (결정 / 이유 / 날짜)

---

## 2. 절대 규칙 (깨지면 되돌릴 것)

1. **`SUPABASE_SERVICE_ROLE_KEY`는 절대 Next.js 런타임에 들어가지 않는다.** Trigger.dev 태스크 전용. `NEXT_PUBLIC_*` 접두사를 붙이는 순간 공개 키가 된다. 앱은 anon 키 + RLS로만 DB에 접근한다.
2. **발행된 기사는 수정하지 않는다.** 오류는 `unpublished`로 내리고, 가치 있으면 새 기사로 재생성한다. `UPDATE articles SET body/title ... WHERE status='published'` 같은 코드를 쓰지 말 것.
3. **모든 테이블에 RLS. 예외 없음.** `articles`·`article_sources`·`article_translations`의 select 정책은 `status='published'`인 행만 허용한다. draft가 공개 키로 새어나가면 사고다. `seen_feed_items`·`source_texts`·`pipeline_runs`는 RLS만 켜고 정책을 두지 않는다(anon에게 0행).
4. **튜닝 값은 코드가 아니라 config다.** threshold(10), 최소 축 점수(3), daily cap(3), rescoring band(2), follow-up window(7일), pending TTL(3일), 소스 tier 목록, 필수 자산 목록 — 전부 `src/config/`에 있고 배포 없이 바꿀 수 있어야 한다. 숫자를 로직 안에 하드코딩하지 말 것.
   선정 규칙 표기는 항상 **`총점 ≥ 10 && 모든 축 ≥ 3`**. "어느 축도 2 이하가 아님" 같은 부정형으로 쓰지 말 것.
5. **근거 검증(grounding)에 실패한 기사는 발행하지 않는다.** 완화하거나 경고로 낮추는 방향의 수정은 하지 말 것. 기사 수가 줄어드는 건 의도된 비용이다.
6. **비용 상한을 코드로 강제한다.** 토픽당 검색 3회, 페이지 fetch 10회, 이미지 1장, 하루 기사 3개. 프롬프트에 부탁하는 게 아니라 호출 지점에서 카운터로 막는다.
7. **모델 ID는 고정 상수로만 쓴다.** `src/config/models.ts`에만 둔다.
   - `claude-sonnet-5` — **출처 본문을 읽는 모든 단계**(작성·클레임 추출·검증·재작성) + 번역 + 월간 요약
   - `claude-haiku-4-5` — 쿼리 생성·그룹핑·1차 채점·재채점 (날짜 접미사 없음. `effort` 미지원)
   출처 본문을 읽는 단계 중 하나라도 모델을 바꾸면 prompt cache가 깨져 비용이 뛴다. 비용 최적화를 하더라도 이 네 단계는 건드리지 말 것.
8. **외부 페이지를 가져올 때 robots.txt를 확인하고, 식별 가능한 User-Agent를 쓰고, 도메인당 요청 간격을 둔다.**
9. **Next 16은 학습 데이터와 다르다.** API·규약·파일 구조가 바뀌었다 (예: `middleware.ts` → `proxy.ts`). Next 관련 코드를 쓰기 전에 `node_modules/next/dist/docs/` 의 해당 문서를 읽는다. 저장소 루트의 `AGENTS.md`가 이 경고를 담고 있으며 `next dev`가 자동 재생성한다.

---

## 3. 프로젝트 구조

```
CLAUDE.md
docs/                     MASTER_PLAN / ARCHITECTURE / ROADMAP / DECISIONS / RUBRIC / STYLE_GUIDE
supabase/migrations/      SQL 마이그레이션 (스키마 변경은 반드시 여기 파일로)
src/
  app/                    Next.js App Router. 4.0에서 app/[locale]/ 로 재배치 (D-08, D-13)
  proxy.ts                접근 게이트. Next 16에서 middleware.ts 규약이 proxy.ts 로 개명됨
  components/             UI 컴포넌트
  messages/               next-intl 메시지 (en.json / ko.json)
  clients/                외부 API 클라이언트. anthropic / brave(3.2) / fal(5.3)
  config/                 튜닝 값. models / thresholds / feeds / filters / source-tiers / required-assets
  db/                     DB 타입, 쿼리 헬퍼, Supabase 클라이언트(anon / server / service)
  pipeline/               파이프라인 "로직". 순수 함수 중심, Trigger.dev에 의존하지 않음
    discover/ group/ score/ research/ write/ verify/ translate/ illustrate/ publish/
  trigger/                Trigger.dev 태스크 정의. 얇은 래퍼
  prompts/                프롬프트 템플릿 + 출력 스키마(zod)
fixtures/                 실제 토픽 + 캐시된 출처 본문 (프롬프트 반복 테스트용)
tests/
trigger.config.ts
```

**핵심 경계: `src/trigger/`는 얇게, `src/pipeline/`은 두껍게.**
태스크 파일은 입력 파싱 → `pipeline/` 함수 호출 → 결과 저장, 그 이상을 하지 않는다. 판단 로직이 태스크 파일에 들어가면 fixture로 테스트할 수 없게 된다.

`src/pipeline/`은 Supabase도 Trigger.dev도 직접 import하지 않는 것을 기본으로 한다. 필요한 데이터는 인자로 받고, 결과는 반환한다.

---

## 4. 작업 방식

- **로드맵 태스크 하나 = 작업 단위 하나.** `docs/ROADMAP.md`의 완료 기준을 실제로 만족시킨 뒤에 다음으로 넘어간다. 여러 태스크를 한 번에 묶지 말 것 (리뷰가 불가능해진다).
- 태스크를 시작하기 전에 해당 Phase의 완료 조건을 다시 읽는다.
- **AI 호출이 들어가는 단계는 fixture로 먼저 돌린다.** 라이브 검색/발행으로 프롬프트를 반복 실험하지 말 것 (비용 + 재현 불가).
- 모든 LLM 출력은 zod 스키마로 검증한다. 검증 실패는 재시도 대상이지 무시 대상이 아니다.
- **출처 본문 블록은 네 단계에서 동일한 순서·형식으로 프롬프트 앞부분에 배치한다.** 순서가 달라지면 캐시 프리픽스가 깨진다. 단계별로 다른 지시문은 블록 뒤에 붙인다.
- 파이프라인 단계를 추가하면 `pipeline_runs`에 그 단계의 비용(토큰/호출 수)도 같이 기록한다. Trigger.dev 무료 티어는 로그를 하루만 보관하므로, 로그가 아니라 DB가 기록의 원본이다.
- 스키마 변경은 항상 `supabase/migrations/`의 새 파일로. 기존 마이그레이션을 편집하지 않는다.
- **커밋 메시지는 영문으로 쓴다.** 태스크 번호로 시작한다: `feat(2.4): first-pass importance scoring`.
  저장소가 GitHub 에 공개돼 있고 커밋 로그는 바깥에서 읽힌다. 문서(`docs/`)와 코드 주석은 한국어 그대로 둔다 — 그건 작업용이다.
- **커밋 메시지와 PR 본문에 Claude 관련 표기를 넣지 않는다.** `Co-Authored-By: Claude ...` 트레일러, `🤖 Generated with ...` 문구 모두 제외한다.

## 5. 하지 말 것

- 다른 매체의 기사를 요약·번역해서 싣는 것 (저작권 노출). 출처는 **조사 재료**이지 원문이 아니다.
- 커버 이미지 프롬프트에 실존 인물·로고·브랜드·텍스트 넣기.
- 실패한 기사 자리에 placeholder 이미지나 "번역 준비 중" 같은 반쪽 상태를 공개 사이트에 노출하기. 자산이 다 모이기 전엔 발행하지 않는다.
- 원본 RSS 본문이나 가져온 페이지 전문을 영구 저장하기. 가져온 본문은 `source_texts` 테이블에 `expires_at`과 함께 두고, 매 런 종료 시 정리 태스크가 지운다.
- Phase 7 이전에 접근 게이트를 푸는 것.
- 기획서에 없는 기능 추가 (챗봇, 개인화 스타일, 댓글 등). 필요하면 먼저 `docs/DECISIONS.md`에 올린다.
