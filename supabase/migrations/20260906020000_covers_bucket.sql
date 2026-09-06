-- 커버 이미지 버킷 (로드맵 5.3)
--
-- Storage 는 커버 이미지 전용이다 (ARCHITECTURE §1). 출처 본문은 여기가 아니라
-- source_texts 테이블에 둔다 (D-05).

-- 공개 버킷이다. 커버는 목록·상세 페이지의 <img> 로 그대로 나가야 하고,
-- 서명 URL 을 쓰면 페이지마다 서명 요청이 붙는다.
--
-- **파일 이름은 기사 slug 가 아니라 id(uuid) 다.** 사이트는 Phase 7 까지
-- 게이트 뒤에 있는데(CLAUDE.md §5), slug 로 저장하면 제목만 알면 이미지 URL 을
-- 맞힐 수 있다. uuid 는 DB 를 못 보면 알 수 없다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'covers',
  'covers',
  true,
  5242880,                                  -- 5MB. 1024×576 jpeg 는 100KB 안팎이다
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 정책
--
-- 읽기는 누구나, 쓰기는 파이프라인(service_role)만.
-- service_role 은 RLS 를 우회하므로 쓰기 정책을 따로 두지 않는다 —
-- 정책을 만들면 "앱도 쓸 수 있나" 하는 오해가 생긴다
-- ─────────────────────────────────────────────────────────────

create policy "커버 이미지는 누구나 읽는다"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'covers');
