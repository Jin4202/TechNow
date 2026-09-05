# ARCHITECTURE

TechNow의 시스템 구조. 기획 의도와 "왜"는 `MASTER_PLAN.md`, 진행 순서는 `ROADMAP.md`, 기획서 이후 내려진 판단은 `DECISIONS.md`에 있다.
이 문서는 **무엇이 어디서 돌고, 데이터가 어떻게 흐르며, 어떤 불변식을 지켜야 하는지**를 다룬다.

기획서(v3)와 다른 부분은 **[D-nn]** 으로 표시했다. 근거는 `DECISIONS.md`의 같은 번호에 있다.

---

## 1. 런타임 경계

세 개의 실행 환경이 있고, 각각 다른 자격증명을 쓴다.

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│  Next.js (Vercel)        │        │  Trigger.dev Cloud            │
│  - 공개 기사 페이지 (SSR) │        │  - 일간 파이프라인 (01:00 PT)  │
│  - 로그인 / 스크랩 / 설정 │        │  - 발행       (07:00 PT)      │
│                          │        │  - 월간 요약  (매월 1일)       │
│  anon key + RLS          │        │  service_role key             │
│  읽기 위주, 사용자 쓰기만 │        │  기사 생성/발행 전담           │
└───────────┬──────────────┘        └───────────────┬───────────────┘
            │                                       │
            │              ┌────────────────────────┘
            ▼              ▼
      ┌─────────────────────────────────────┐     ┌──────────────────┐
      │  Supabase                           │     │  외부 API        │
      │  Postgres · Auth · Storage · RLS    │     │  Claude          │
      │  (Storage = 커버 이미지 전용)        │     │  Brave Search    │
      └─────────────────────────────────────┘     │  Flux schnell    │
                                                  │  RSS / 출처 웹페이지│
                                                  └──────────────────┘
```

**불변식**
- Next.js는 기사를 **쓰지 않는다.** 사용자가 만드는 데이터(profile, scrap)만 쓴다.
- Trigger.dev는 사용자 요청을 받지 않는다. 스케줄과 수동 트리거로만 돈다.
- service_role key는 Trigger.dev 환경변수에만 존재한다.
- **모든 테이블에 RLS. 예외 없음** [D-02].

---

## 2. 스케줄과 일간 파이프라인

### 스케줄 3개 [D-04]

Trigger.dev 무료 티어 스케줄 한도는 10개다. 여유가 있으므로 **장애 격리를 위해 발행을 분리한다.**

| 스케줄 | 시각 | 역할 |
|---|---|---|
| `daily-pipeline` | 01:00 America/Los_Angeles | 발굴 → 선정 → 기사 생성 → `ready` 까지 |
| `publish-batch` | 07:00 America/Los_Angeles | `ready` 인 기사를 일괄 `published` |
| `monthly-summary` | 매월 1일 | 전월 스크랩 요약 |

파이프라인 런이 걸려 있거나 실패해도 발행 스케줄은 독립적으로 돌아 `ready` 기사를 내보낸다. 두 런을 하나로 묶어 6시간 대기시키면 파이프라인 장애가 그대로 발행 장애가 된다.

**06:30 컷오프**는 파이프라인 쪽 가드다. 06:30 이후에는 `build-article`이 기사를 `ready`로 승격시키지 않고 `ready_pending`으로 남긴다. 07:00 발행 태스크는 그 시점의 `ready`만 본다. 30분 버퍼는 승격과 발행 사이의 경합을 없애기 위한 것이다.

**DST 주의.** America/Los_Angeles는 서머타임이 있다. Trigger.dev cron에 타임존을 지정하고, 코드 안에서 경과시간을 벽시계 시간으로 계산하지 않는다.

### 일간 파이프라인 흐름

```
01:00  discover      피드 수집 → seen_feed_items 조회
                     · 신규 항목 → pending 으로 삽입
                     · 기존 pending 항목 → 후보에 다시 포함   [D-01]
                     · 3일 지난 pending → 폐기
       filter        길이/홍보성/키워드 (코드, LLM 없음)
       group         [Haiku] 같은 사건 묶기 + 최근 7일 발행 제목 대조 → new / follow-up
       score         [Haiku] 토픽별 novelty·impact·interest 각 1~5 + 근거 한 줄
       rescore       임계선 ±2 토픽만 트리거 페이지 fetch 후 재채점
       select        총점 ≥ 10 && 모든 축 ≥ 3 → 상위 최대 3개   [D-09]
       ─────────────  여기까지 성공해야 후보 전체를 processed 로 갱신  [D-01]

       토픽마다 (병렬, 자식 태스크):
         research    [Haiku] 쿼리 2~3개 생성 → Brave 검색 → tier 필터 → fetch+추출
                     → 3~5개 확보 → source_texts 에 저장          [D-05]
         write       [Sonnet] 구조화 JSON 기사                     ┐
         extract     [Sonnet] 검증 가능한 클레임 추출               │ 출처 본문 블록
         verify      [Sonnet] 클레임을 출처와 대조                  │ 캐시 공유  [D-06]
         rewrite     [Sonnet] 실패 시 1회 재작성                    ┘
         translate   [Sonnet] 한국어 (출처 본문 미사용)
         illustrate  Flux schnell → Supabase Storage
       → 자산 전부 완료 && 06:30 이전 → status = ready

       cleanup       expires_at 지난 source_texts 삭제             [D-05]
       log           pipeline_runs 한 행 (건수 + cost_fixed + cost_variable)  [D-07]

07:00  publish       status='ready' 인 기사 일괄 published
                     없으면 사이트가 "No new stories today"
```

### 태스크 분해와 재시도

| 태스크 | 종류 | 재시도 | 실패 시 |
|---|---|---|---|
| `daily-pipeline` | 스케줄 (부모) | 0 | 런 전체 실패 로그. `pending` 항목이 남으므로 다음 날 재처리 |
| `fetch-feeds` | 자식 (피드당) | 2 | 해당 피드만 건너뜀 |
| `select-topics` | 자식 | 1 | 그룹핑 실패 시 항목별 개별 토픽으로 폴백 |
| `build-article` | 자식 (토픽당) | 1 | 해당 토픽만 skip, 나머지는 진행 |
| `verify-grounding` | build 내부 | 1 (실패 사유 첨부) | 2회 실패 → 토픽 skip |
| `translate` / `illustrate` | build 내부 | 1 | 실패 → `ready_pending` 유지, 다음 런에서 재시도 |
| `cleanup-source-texts` | 자식 | 2 | 로그만. 다음 런에서 다시 정리됨 |
| `publish-batch` | 스케줄 | 2 | 알림 |

**토픽 단위 병렬 처리**가 핵심이다. 한 기사의 이미지 생성 실패가 다른 기사의 발행을 막아서는 안 된다.

**멱등성.** `build-article`은 `(run_id, topic_hash)`를 idempotency key로 쓴다. 재시도가 기사를 중복 생성하면 안 된다. `topic_hash`는 그룹핑 결과의 정규화된 제목+URL 집합 해시.

---

## 3. 조사·작성·검증 (Phase 3의 핵심)

### 출처 확보
1. 쿼리 생성 [Haiku] (사건명 / 관련 기관 / 논문·발표 제목 추정) — 최대 3개
2. Brave Search — 링크만 받음. 본문 추출은 우리 코드가 한다
3. `src/config/source-tiers.ts` 로 URL 필터링 (Tier 1 / Tier 2 / block list)
4. 순위 순으로 직접 fetch → Readability 계열 추출
5. 페이월 판정: 추출 본문이 너무 짧거나 구독 유도 문구 포함 → skip
6. 5개 확보 시 중단. 3개 미만이면 토픽 폐기 + 로그
7. 해당 토픽에 Tier 1이 존재한다면 최소 1개는 Tier 1이어야 한다
8. 확보한 본문을 `source_texts`에 저장 [D-05]

상한: 검색 3회, fetch 10페이지. 카운터로 강제한다 (`CLAUDE.md` §2.6).

### 기사 본문 포맷 [D-03]

`articles.body`는 **JSONB 섹션 배열**이다.

```jsonc
{
  "sections": [
    {
      "heading": "무엇이 발표되었나",
      "paragraphs": ["...", "..."],
      "sources": [1, 3]          // article_sources.ordinal 참조
    }
  ]
}
```

- `article_sources.ordinal`은 1부터 시작한다.
- 번역본도 **동일한 구조**로 저장하고, `sources` 배열은 그대로 복사한다.
- **구조 정합성 검증(코드)**: 번역본의 `sections.length`가 원문과 같고, 각 섹션의 `sources` 배열이 원문과 정확히 일치해야 한다. 불일치는 번역 실패로 처리한다.
- `sources`에 존재하지 않는 ordinal이 들어오면 작성 실패로 처리한다.
- 렌더링은 이 구조를 읽어서 한다. 마크다운 문자열을 통째로 넣지 않는다.

### Grounding check

세 단계 모두 Sonnet이다. 문자열 매칭은 `"5 million"` vs `"5,000,000"` 에서 실패하므로 쓰지 않는다.

1. **클레임 추출** — 숫자, 인명/기관명, 날짜, 인과 진술을 목록화
2. **대조 검증** — 각 클레임을 `source_texts`의 본문과 대조. 하나라도 unsupported면 발행 차단
3. **재작성** — 실패 사유를 붙여 1회 재시도. 두 번째도 실패하면 토픽 skip

이 검증은 방어선이지 정확성의 증명이 아니다. 통과했다고 사실이 보장되지 않는다.

### 프롬프트 캐시 규약 [D-06]

출처 본문을 읽는 네 단계(작성 / 추출 / 검증 / 재작성)는 **전부 `claude-sonnet-5`** 이고, 캐시를 공유한다.

지켜야 할 것:
- 출처 본문 블록은 **모든 단계에서 동일한 순서, 동일한 형식, 프롬프트 앞부분**에 놓는다. 순서가 하나라도 달라지면 캐시 프리픽스가 깨진다.
- 단계별로 달라지는 것(지시문, 이전 단계 출력)은 **블록 뒤에** 붙인다.
- 모델을 섞지 않는다. 한 단계라도 Haiku로 내리면 그 단계는 캐시를 못 쓰고 20k 토큰을 새로 지불한다.

**주의: 캐시에는 TTL이 있다.** 네 단계 체인이 TTL 안에 끝나야 재사용된다. 단계 사이에 긴 백오프가 끼면 캐시가 만료되어 미스가 난다. 체인을 한 태스크 안에서 연속 실행하고, 정확한 TTL과 파라미터는 `claude-api` skill로 확인해 3.8a에서 `DECISIONS.md`에 기록한다.

---

## 4. 데이터 모델

`MASTER_PLAN.md` §4 기준. 기획서와 달라진 부분은 표시했다.

```
profiles
  id (auth.users 참조), display_name, locale (en|ko), premium bool, created_at

seen_feed_items                                              [D-01]
  url_hash (PK), feed_name, first_seen_on, run_id
  status (pending | processed), processed_at
  → pending: 아직 선정 단계를 통과해 본 적 없음. 다음 런의 후보에 다시 포함
  → processed: 선정 단계까지 정상 종료됨. 선정/탈락 무관
  → pending 이 3일 넘으면 폐기 (config: pendingTtlDays)

articles
  id, slug (unique), category (enum 7종), tags[]
  score_novelty, score_impact, score_interest, importance_score
  run_id                   [추가] 생성한 런. topic_hash 와 묶어 멱등성 키
  topic_hash               [추가] 그룹핑 결과의 정규화 해시
  follow_up_of (nullable → articles.id)
  title, one_line_summary
  body JSONB               [D-03] 섹션 배열 (§3)
  cover_image_url (nullable)
  status (draft|ready_pending|ready|published|failed|unpublished)
  held_back_count          [추가] 2 도달 시 failed 처리
  style_guide_version, published_at, created_at

article_sources
  id, article_id, ordinal  [D-03], url, title, publisher, tier (1|2), fetched_at

article_translations
  id, article_id, locale, title, one_line_summary, body JSONB [D-03], created_at
  unique(article_id, locale)

source_texts                                                 [D-05]
  id, run_id, topic_hash, article_id (nullable), url, extracted_text, expires_at, created_at
  → 조사~검증 단계가 공유하는 임시 저장소. 영구 보관하지 않는다
  → 매 런 종료 시 expires_at 지난 행 삭제

scraps                 id, user_id, article_id, scraped_at   unique(user_id, article_id)
monthly_summaries      id, user_id, month_start, locale, summary_text, article_ids[], created_at
pipeline_runs          id, run_type, started_at, finished_at, status,
                       topics_seen, topics_selected, articles_published,
                       cost_search_calls, cost_pages_fetched, cost_images,
                       cost_input_tokens, cost_output_tokens, cost_cached_tokens,
                       cost_fixed, cost_variable                 [D-07]
                       notes
```

### 스키마에서 코드로 강제하는 것

마이그레이션의 check 제약이 지키는 불변식. 애플리케이션 버그가 DB까지 오염시키지 않게 한다.

| 제약 | 내용 |
|---|---|
| `articles_body_has_sections` | `body`에 `sections` 배열이 반드시 있다. **`coalesce` 필수** — `jsonb_typeof`가 NULL을 돌려주면 check 제약은 통과로 취급한다 |
| `articles_published_has_timestamp` | `status='published'`면 `published_at`이 있다 |
| `articles_no_self_follow_up` | 자기 자신을 follow-up 하지 않는다 |
| `articles_run_topic_idx` (unique) | `(run_id, topic_hash)` 중복 생성 차단 |
| 점수 축 | 각 축 1~5, `importance_score` 3~15 |
| `article_sources` | `ordinal >= 1`, `tier in (1,2)`, `(article_id, ordinal)` 유니크 |
| `seen_feed_items_processed_at_matches_status` | `processed`면 `processed_at`이 있고, `pending`이면 없다 |

### `seen_feed_items` 상태 전이 [D-01]

```
(신규 RSS 항목)
      │  discover 단계에서 삽입
      ▼
   pending ──────── select 단계 정상 종료 ────────▶ processed
      │                (선정/탈락 무관)
      │  런이 중간에 실패
      ▼
   pending (그대로) ──▶ 다음 날 후보에 다시 포함
      │
      │  3일 경과
      ▼
   폐기
```

**탈락 항목도 `processed`다.** 임계값을 못 넘은 것은 정상적인 처리 완료이며, 매일 다시 채점하면 비용만 든다.
`processed` 행은 90일 후 정리한다(재게시되는 피드 항목을 계속 걸러야 하므로 follow-up 윈도우보다 길게).

### RLS 정책 [D-02]

**모든 테이블에 RLS를 켠다. 예외 없음.** 파이프라인은 RLS를 우회하는 service_role key로 쓴다.

| 테이블 | anon / authenticated | 쓰기 |
|---|---|---|
| `articles` | `SELECT` where `status = 'published'` | 없음 (service_role만) |
| `article_sources` | 부모 기사가 published일 때만 SELECT | 없음 |
| `article_translations` | 부모 기사가 published일 때만 SELECT | 없음 |
| `profiles` | 본인 행만 | 본인 행 UPDATE |
| `scraps` | 본인 행만 | 본인 행 INSERT / DELETE |
| `monthly_summaries` | 본인 행만 SELECT | 없음 |
| `seen_feed_items` | 정책 없음 (0행) | 없음 |
| `source_texts` | 정책 없음 (0행) | 없음 |
| `pipeline_runs` | 정책 없음 (0행) | 없음 |

RLS를 켜고 정책을 만들지 않으면 anon에게는 0행이 보인다. 마지막 세 테이블이 그 상태다.

---

## 5. i18n [D-08]

**URL이 언어의 원본이다.** `/[locale]/articles/[slug]` (next-intl 표준 패턴).

- `profiles.locale`은 **언어 없는 경로로 진입했을 때의 리다이렉트 기본값**으로만 쓴다. 로그인 사용자는 자기 locale로, 비로그인은 `en`으로.
- 언어 토글은 profile을 갱신하고 동시에 현재 페이지의 다른 locale 경로로 이동시킨다.
- UI 문자열은 `src/messages/{en,ko}.json`, 기사 본문은 DB(`article_translations`)에서 온다. 이 둘을 섞지 않는다.
- 두 locale 모두 `hreflang` 태그를 낸다.
- Pretendard는 Phase 4부터 두 locale 모두에 적용한다(폰트를 하나로 유지).

계정 설정만으로 콘텐츠 언어를 바꾸면 같은 URL이 두 언어를 서빙하게 되어 SSR 캐싱과 검색 노출이 깨진다.

---

## 6. 설정 vs 코드

`src/config/` 아래는 배포 없이 바뀔 수 있어야 한다.

| 파일 | 내용 |
|---|---|
| `models.ts` | 모델 ID, 단계별 배정, max_tokens. **출처 본문을 읽는 단계는 전부 Sonnet** [D-06] |
| `thresholds.ts` | threshold 10, `minAxis` 3, cap 3, rescoring band 2, follow-up window 7일, `pendingTtlDays` 3 |
| `feeds.ts` | RSS 피드 목록 (카테고리 커버리지 포함) |
| `source-tiers.ts` | Tier 1 / Tier 2 도메인, block list, 페이월 감지 문구 |
| `required-assets.ts` | Phase별 발행 필수 자산 (P3: 영문 / P4: +번역 / P5: +이미지) |
| `budget.ts` | 토픽당 검색·fetch 상한, 월 예산, 알림 임계, `sourceTextTtlDays` |

Phase 2.6의 완료 기준이 "config를 바꾸면 배포 없이 선정 결과가 바뀐다"이므로, 최소한 이 값들은 DB 또는 환경변수에서 오버라이드 가능해야 한다.

---

## 7. 비용 모델 [D-07]

```
월 비용 = cost_fixed × 30 + cost_variable × 기사 수  ≤  20 USD
```

| 구분 | 범위 | 목표 |
|---|---|---|
| `cost_fixed` | 발굴 · 필터 · 그룹핑 · 채점 · 재채점 (기사 0개인 날에도 발생) | 런당 측정, 로그로 관리 |
| `cost_variable` | 조사 · 작성 · 검증 · 번역 · 이미지 (기사별) | **기사당 0.20 USD 이하** |

0.20 USD 목표는 **변동비에만** 적용한다. 전체 비용을 기사 수로 나누면 조용한 날의 단가가 왜곡되어 잘못된 최적화를 하게 된다.

비용 레버 (순서대로):
1. prompt caching (§3) — 가장 큰 절감. `cost_cached_tokens`로 적중을 확인한다
2. 단계별 모델 재배정 — 단, 출처 본문을 읽는 단계는 건드리지 않는다 (캐시가 깨진다)
3. 근접 재채점 밴드 축소 (고정비 절감)
4. Batch API — 지연을 감당할 수 있으므로 적합하지만 복잡도가 늘어 후순위

각 외부 서비스의 무료 티어 한도(Brave 월 쿼리 수, Trigger.dev 실행 시간, Supabase 용량)는 해당 태스크에서 실제로 확인해 `DECISIONS.md`에 기록한다. 추정치로 계획하지 말 것.

---

## 8. 테스트 전략

| 대상 | 방법 |
|---|---|
| `src/pipeline/` 순수 함수 (필터, tier 판정, 임계 규칙, 페이월 감지) | 단위 테스트. 여기가 로직의 대부분이어야 한다 |
| LLM 출력 | 내용의 정확성이 아니라 **형식**을 테스트한다. zod 스키마, 필수 필드 |
| 본문 구조 | 섹션의 `sources`가 실재하는 ordinal인지, 번역본 섹션 수·출처 배열이 원문과 일치하는지 [D-03] |
| `seen_feed_items` 상태 전이 | 중간 실패를 강제했을 때 항목이 `pending`으로 남아 다음 런에 재등장하는지 [D-01] |
| 프롬프트 변경 | `fixtures/`의 5~10개 실제 토픽으로 재실행. 라이브 검색 없이 |
| grounding | 조작한 숫자가 걸리는지 + 표기만 다른 참값이 안 걸리는지, 양방향 |
| 파이프라인 전체 | Trigger.dev 대시보드 테스트 버튼 / 수동 트리거. 스케줄을 기다리지 않는다 |
| RLS | anon 키로 draft 기사·타인 scrap·`pipeline_runs` 접근 시 전부 0행인지 |

---

## 9. 보안·운영

- 접근 게이트: `src/proxy.ts`의 basic auth (D-11). `GATE_USER`/`GATE_PASSWORD` 미설정 시 통과가 아니라 503으로 차단한다. `7.7`에서 파일째 제거
- 사용자 데이터: profile, scrap, monthly summary만. 삭제 요청 시 cascade 되도록 FK 설계
- 알림: 배치 실패(7.4), 예산 80% 초과(7.5), 기사 2회 연속 hold-back
- 기사 오류 발생 시 절차: `published` → `unpublished` 로 상태 변경 (삭제 아님) → 필요하면 새 기사 생성
- 외부 페이지 fetch: robots.txt 확인, 식별 가능한 User-Agent, 도메인당 요청 간격
