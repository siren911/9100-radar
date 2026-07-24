-- =====================================================================
-- 9100-radar Phase 2 — 데이터베이스 스키마 (Step 1)
-- Supabase SQL Editor 에 전체 붙여넣기 → RUN
-- 여러 번 실행해도 안전하도록 IF NOT EXISTS / DROP POLICY 처리됨
-- =====================================================================

-- ─────────────────────────────────────────────
-- 1) posts : 인터넷에서 주워온 원시 제보 (가공 전)
-- ─────────────────────────────────────────────
create table if not exists public.posts (
  id           bigint generated always as identity primary key,
  url          text not null unique,          -- 중복 방지 열쇠
  source       text not null,                 -- reddit / rss / samsung_community ...
  lang         text,                          -- en / ko / ja / zh
  title        text,
  excerpt      text,                          -- 발췌 (최대 500자, 원문 전문 저장 금지)
  posted_at    timestamptz,
  collected_at timestamptz not null default now(),
  raw_hash     text,                          -- 정규화 텍스트 해시 (중복 판별용)
  case_id      text,                          -- 어느 사례에 묶였는지 (분류 후 채움)
  meta         jsonb default '{}'::jsonb
);
create index if not exists idx_posts_source     on public.posts(source);
create index if not exists idx_posts_collected  on public.posts(collected_at);

-- ─────────────────────────────────────────────
-- 2) clusters : 비슷한 증상끼리 묶은 사례 그룹
-- ─────────────────────────────────────────────
create table if not exists public.clusters (
  id         text primary key,                -- CL-FW, CL-G5 ...
  name       text,
  summary    text,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 3) cases : 정리된 고유 사례 (대시보드에 보이는 것)
--    현재 index.html 의 CASES 구조를 그대로 반영 + 향후 확장 컬럼(mk/cs/bios)
-- ─────────────────────────────────────────────
create table if not exists public.cases (
  id          text primary key,               -- RC-101 ...
  cluster     text references public.clusters(id),
  cat         text,                            -- 카테고리 코드 (G1, A1 ...)
  sev         int,                             -- severity 1~5
  evidence    text,                            -- 증거 수준 코드 (o/u/r/m/x)
  region      text,
  cap         text,                            -- 용량 (8TB, 미상 ...)
  fw          text,                            -- 펌웨어 버전
  mk          text,                            -- 제조사/메인보드 (향후 추출)
  cs          text,                            -- 칩셋 (향후 추출)
  bios        text,                            -- BIOS 버전 (향후 추출)
  plat        text,                            -- 플랫폼/환경
  title       text,
  claims      jsonb default '[]'::jsonb,       -- 사용자 주장 목록
  hyps        jsonb default '[]'::jsonb,       -- 가설 목록
  counter     text,                            -- 반증/대조 메모
  q           text,                            -- 대표 인용구
  qsite       text,                            -- 인용 출처명
  src         text,                            -- 원문 URL
  fw1b        boolean default false,           -- 1B2QNXH7 펌웨어 관련 하이라이트
  plat_wide   boolean default false,           -- 플랫폼 전반 의심 배지
  posts_count int default 0,                   -- 관련 제보 수
  last_seen   date,                            -- 마지막 관측일
  demo        boolean default false,           -- 시드/데모 데이터 표식
  updated_at  timestamptz not null default now()
);
create index if not exists idx_cases_cluster on public.cases(cluster);
create index if not exists idx_cases_sev     on public.cases(sev);

-- ─────────────────────────────────────────────
-- 4) collection_runs : 수집 로봇 출근 기록부
-- ─────────────────────────────────────────────
create table if not exists public.collection_runs (
  run_id   bigint generated always as identity primary key,
  source   text,
  started  timestamptz not null default now(),
  finished timestamptz,
  fetched  int default 0,                      -- 가져온 개수
  new      int default 0,                      -- 신규(중복 제외) 개수
  errors   int default 0,
  note     text
);

-- ─────────────────────────────────────────────
-- 5) model_runs : AI 검수원 작업·비용 기록부
-- ─────────────────────────────────────────────
create table if not exists public.model_runs (
  id            bigint generated always as identity primary key,
  ran_at        timestamptz not null default now(),
  stage         text,                          -- stage1 / stage2 / stage3 / summary
  model_id      text,                          -- claude-haiku-4-5 ...
  prompt_ver    text,
  input_tokens  int default 0,
  output_tokens int default 0,
  cost_usd      numeric(10,4) default 0,
  post_id       bigint,
  note          text
);

-- =====================================================================
-- RLS (행 수준 보안) : 공개(anon) 열쇠는 읽기만, 쓰기는 마스터(service_role)만
-- =====================================================================
alter table public.posts           enable row level security;
alter table public.clusters        enable row level security;
alter table public.cases           enable row level security;
alter table public.collection_runs enable row level security;
alter table public.model_runs      enable row level security;

-- 공개 열쇠에 "읽기 전용" 허용 (대시보드가 사용)
drop policy if exists "public read cases"    on public.cases;
drop policy if exists "public read clusters" on public.clusters;
drop policy if exists "public read runs"     on public.collection_runs;
create policy "public read cases"    on public.cases           for select using (true);
create policy "public read clusters" on public.clusters        for select using (true);
create policy "public read runs"     on public.collection_runs for select using (true);
-- posts / model_runs 는 공개 읽기 정책을 만들지 않음 → 마스터 열쇠만 접근(더 안전)

-- service_role(마스터 열쇠)은 RLS를 자동으로 우회하므로 별도 쓰기 정책 불필요

-- 완료 메시지
do $$ begin raise notice '✅ 9100-radar 스키마 생성 완료 (테이블 5개 + RLS)'; end $$;
