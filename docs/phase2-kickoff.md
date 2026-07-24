# Phase 2 Kickoff — LIVE 수집 전환 (Claude Code용)

> 이 문서는 Claude Code 세션의 시작 브리프다.
> Source of Truth: `docs/spec-v2.md` + `docs/spec-v3-amendment.md` (충돌 시 v3 우선, 본 문서는 v3의 실행 순서를 구체화한다)

## 0. 현재 상태

- 저장소: siren911/9100-radar (GitHub Pages 배포 중, https://siren911.github.io/9100-radar/)
- `index.html` = Phase 1 완성본 (BUILD r7). 실제 검증된 20개 사례가 JS 상수(CASES)로 하드코딩되어 있음
- 목표: 데이터를 Supabase에서 읽어오는 LIVE 모드로 전환하고, GitHub Actions로 주기 수집

## 1. 목표 아키텍처 (v3 §6 확정안)

```
GitHub Actions (cron 60분)          Supabase (PostgreSQL)         GitHub Pages
┌──────────────────────┐            ┌─────────────────┐           ┌──────────────┐
│ collector (Node.js)  │ ─ 저장 ──▶ │ posts / cases    │ ◀─ 읽기 ─ │ index.html   │
│ 1) 소스 수집          │            │ clusters         │  (anon,   │ LIVE/STALE   │
│ 2) 중복 제거          │            │ collection_runs  │   RLS RO) │ 배지 표시     │
│ 3) Claude API 분류    │            └─────────────────┘           └──────────────┘
│ 키: GitHub Secrets    │
└──────────────────────┘
```

## 2. Phase 2 스코프 (이 순서대로, 단계마다 실행 검증 후 다음으로)

### Step 1 — 저장소 구조화 + Supabase 스키마
- 구조: `/index.html`(유지), `/collector/`(Node 스크립트), `/.github/workflows/collect.yml`, `/docs/`(스펙 3종), `/sql/schema.sql`
- 테이블: `posts`(원시 수집: url unique, source, lang, title, excerpt≤500자, posted_at, collected_at, raw_hash), `cases`(고유 사례: 현 index.html CASES 필드 구조 그대로 — id, cluster, cat, sev, evidence, region, cap, fw, mk, cs, bios, plat, title, claims jsonb, hyps jsonb, counter, q, qsite, src, fw1b, plat_wide, posts_count, last_seen), `clusters`, `collection_runs`(run_id, started, finished, source, fetched, new, errors), `model_runs`(v2 §49.7)
- RLS: anon 읽기 전용, 쓰기는 service_role만
- 현재 index.html의 20개 사례를 시드로 `cases`에 INSERT하는 `sql/seed.sql` 생성

### Step 2 — 수집기 1호: 무인증 소스부터
- 2a. Reddit 공개 JSON (`https://www.reddit.com/search.json?q=...`) — API 키 없이 시작 가능, User-Agent 명시, 요청 간격 2초, 429 시 백오프. 검색어: "9100 pro" + (firmware/bios/detect/vanish/slow 등 스펙 §7 키워드)
- 2b. 기술 매체 RSS 3~5종
- robots.txt 존중, 원문 전문 저장 금지(발췌 500자 한도), 사용자명 저장 금지
- 결과를 `posts`에 upsert(url unique로 중복 방지), `collection_runs` 기록

### Step 3 — Claude API 분류 파이프라인 (v3 §7.2 모델 매핑)
- Stage 0: 코드 프리필터(제품명 매칭, 스팸 제거)
- Stage 1: claude-haiku-4-5 — 관련성 0~1 + 언어 + 증상 1줄
- Stage 2: claude-sonnet-4-6 — 관련성≥0.7만: taxonomy, sev, region 추정, fw/칩셋/제조사/BIOS 추출, 기존 case 매칭(신규/병합)
- Stage 3: claude-opus-4-8 — sev≥4 또는 데이터 무결성 주장만 재판정
- 프롬프트에 수집 텍스트는 데이터로만 취급(프롬프트 인젝션 방어, v2 §37), 출력은 JSON 스키마 강제
- 월 예산 가드: 환경변수 MONTHLY_AI_BUDGET, `model_runs`에 토큰·비용 기록

### Step 4 — Actions cron + 프론트 LIVE 전환
- `collect.yml`: schedule 60분 + workflow_dispatch(수동 실행), Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE, ANTHROPIC_API_KEY
- index.html: 로드 시 Supabase REST(anon)에서 cases/clusters/last run fetch
  - 성공+최신: `LIVE` 배지 / 마지막 수집 2시간 초과: `STALE` / fetch 실패: `OFFLINE + 내장 시드 폴백`
  - 기존 SEED 하드코딩은 폴백 데이터로 유지
- 배지·레일의 "수동 검증" 문구를 실제 수집 시각으로 교체, BUILD 번호 증가

## 3. 구현하지 않는 것 (Phase 2 네거티브 스코프)
- Amazon/JD/Tmall/X 수집 (POLICY_BLOCKED 유지)
- Reddit 공식 OAuth API 전환(추후), 로그인 필요 소스, 관리자 페이지, 알림 웹훅(Phase 3)
- 대조군(990 PRO 등) 수집은 Phase 2 완료 후

## 4. 안전·품질 규칙 (필수)
- 키는 코드·프론트에 절대 노출 금지 — GitHub Secrets만. 프론트에는 SUPABASE_URL + anon key만
- 모든 화면 표현은 "제보/주장/미검증" — 결함 확정 표현 금지 (v2 표현 규칙)
- 각 단계 완료 시: 실제 실행 로그 + Supabase 데이터 확인 + 스크린샷/쿼리 결과 제시 후 다음 단계 (테스트 없이 완료 선언 금지)
- 커밋은 단계별로 분리, 메시지에 Step 번호 명시

## 5. 사용자가 준비해야 하는 것 (세션 시작 전)
1. Supabase 프로젝트 생성 → Project URL, anon key, service_role key 확보
2. Anthropic API 키 (console.anthropic.com)
3. GitHub 저장소 Settings → Secrets and variables → Actions에 위 키 등록
4. 로컬에 저장소 clone (`git clone https://github.com/siren911/9100-radar`)

## 6. 시작 명령 (Claude Code에 붙여넣기)

```
docs/ 안의 spec-v2.md, spec-v3-amendment.md, phase2-kickoff.md를 모두 읽어라.
충돌 시 우선순위: kickoff > v3 > v2.
Step 1부터 시작하고, 각 Step은 실제 실행 검증 결과를 보여준 뒤 내 승인을 받고 다음으로 진행하라.
Supabase 키는 내가 .env로 제공한다. 키를 코드에 하드코딩하지 마라.
```
