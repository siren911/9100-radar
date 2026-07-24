---
title: "9100 PRO Global Signal Radar — v3 Amendment"
document_type: "v2 스펙 개정 지침 (v2 문서와 함께 전달할 것)"
version: "3.0"
prepared_date: "2026-07-23"
priority_rule: "본 문서와 v2 스펙이 충돌하면 본 문서(v3)가 우선한다"
---

# 0. 이 문서의 역할

v2 스펙(`samsung_9100pro_global_voc_radar_fable_spec_v2_100point.md`)은 유효한 Source of Truth로 유지한다.
본 문서는 v2의 8개 항목을 **개정·추가·확정**한다. Claude는 두 문서를 함께 읽고, 충돌 시 본 문서를 따른다.

---

# 1. [개정] Phase 분리와 단일 세션 스코프

v2 §65의 "Phase 1 완성 + Production 구조 동시 준비" 지시를 폐기하고 다음으로 대체한다.

## 1.1 Phase 1 세션에서 구현하는 것

- 단일 HTML 파일 반응형 대시보드 (ARTIFACT_DEMO 모드)
- Executive Overview / Analyst Workbench 2개 뷰
- DEMO 데이터 탐색: 필터, 검색, 정렬, 이슈 상세, Evidence Drawer
- CSV 내보내기
- `DEMO DATA` 배지 상시 표시, STALE/OFFLINE 상태 표기 로직
- v2 §23의 Seed 1~9 사례 기반 DEMO 데이터 (약 60~100건 규모로 확장 생성, 전건 `demo: true` 표식)

## 1.2 Phase 1 세션에서 구현하지 않는 것 (네거티브 스코프)

- 실제 수집 커넥터, 스케줄러, 큐, DLQ
- 모노레포, DB migration, CI/CD
- Claude API 실시간 호출 (붙여넣기 텍스트 로컬 분류는 선택 사항)
- 관리자 인증, audit log

## 1.3 Phase 2 이후

Phase 2(LIVE 커넥터), Phase 3(Intelligence), Phase 4(Hardening)는 **Claude Code 세션에서 별도 실행**한다.
Phase 2 착수 시 v2 + v3를 저장소 `docs/`에 넣고 시작한다.

---

# 2. [개정] Artifact 기술 제약 수정

- v2 §35.1의 "브라우저 저장소를 이용한 임시 상태 유지"를 **삭제**한다. Claude.ai Artifact에서 localStorage/sessionStorage는 작동하지 않는다. 상태는 전부 in-memory(React state 또는 JS 변수)로 유지한다.
- 임베딩 모델을 확정한다: Claude API는 임베딩을 제공하지 않으므로 Phase 3에서 **Voyage AI 임베딩(또는 동급 오픈소스 모델)**을 사용한다. Phase 1~2의 중복 제거는 임베딩 없이 **정규화 텍스트 해시 + URL 정규화 + 제목 유사도(단순 문자열)**로 수행한다.

---

# 3. [개정] 소스 커버리지 현실화

v2 §5의 Tier 목록은 장기 로드맵으로 유지하되, 다음을 명시한다.

## 3.1 Phase 2 초기 연결 소스 (현실적 4종)

1. Reddit 공식 API (연구·비상업 조건 및 요금 정책 확인 후 연결)
2. RSS 제공 기술 매체·포럼
3. Samsung Community 공개 게시판 (robots.txt 및 약관 준수 범위 내)
4. 뉴스·웹 검색 API 1종 (Bing/Brave/SerpAPI 중 택1)

## 3.2 미연결 소스의 화면 처리

- Amazon·JD·Tmall 리뷰, X, Facebook은 공식 수집 경로가 없거나 고비용이므로 초기 미연결로 확정한다.
- Coverage 화면에 `POLICY_BLOCKED`(정책상 미연결), `NOT_CONNECTED`(미구현) 상태를 구분 표기하여 커버리지 한계를 투명하게 보여준다.

---

# 4. [추가] 대조군 코호트 (Control Cohort)

9100 PRO 신호만으로는 "Gen5 플랫폼 전반 이슈"와 "9100 PRO 고유 이슈"를 구분할 수 없다. 다음을 추가한다.

## 4.1 대조 제품

- Samsung 990 PRO (Gen4 자사 대조군)
- 경쟁 Gen5 SSD 1종 (예: Crucial T705)

## 4.2 수집·표시 규칙

- 대조군은 동일 파이프라인으로 **키워드·집계 수준만** 저경비 수집한다 (상세 분류·Adjudication 생략).
- 핵심 지표에 상대 비율을 추가한다: `9100 PRO 신호 수 / (9100 PRO + 대조군 신호 수)` 및 카테고리별 비중 비교.
- 대조군에서도 동일 증상이 유사 비율로 증가하면 경보에 `PLATFORM_WIDE_SUSPECT` 배지를 부여하고 P0 승격을 보류한다.

## 4.3 펌웨어 코호트

- 게시글에서 추출한 펌웨어 버전(예: 0B2QNXH7)별로 신호를 코호트 분리하고, 펌웨어 배포 시점 전후 추이를 별도 차트로 제공한다.

---

# 5. [추가] Golden Dataset 구축 계획과 운영 규칙

## 5.1 라벨링 계획

- 목표: 초기 150건 (영어 80 / 한국어 40 / 일본어 20 / 중국어 10)
- 라벨 항목: 관련성, taxonomy 코드, severity, evidence level, root-cause 후보
- 라벨러: FA 팀 내 2인 교차 라벨 + 불일치 건 리더 판정 (라벨 기준서 1페이지를 먼저 작성)
- 보관: `evals/golden-dataset.jsonl`, 분기 1회 30건 증분

## 5.2 운영 규칙

- 일일 트리아지: 15분/일 (신규 P0~P1 후보 검토 및 승인)
- 신호의 사내 이관: 본 도구는 PUBLIC_DATA_ONLY 경계를 유지하며, 사내 FA 프로세스 연계는 **화면 캡처·CSV 반출 후 사내 시스템에서 별도 처리**한다. 사내 데이터를 본 도구로 역유입하지 않는다.
- 사내 활용 전 보안 검토: 회사 정책에 따른 보안·법무 검토를 Phase 2 착수 전 완료한다.

## 5.3 비용 가드레일

- 4단계 파이프라인 통과율 목표: Stage 0 통과 30% 이하, Stage 3 도달 5% 이하
- 월 예산 상한을 환경변수 `MONTHLY_AI_BUDGET`로 설정하고 80% 도달 시 Stage 3를 수동 승인제로 전환한다.
- 검색 API 무료/저가 티어 쿼터 내 운영을 기본으로 한다.

---

# 6. [확정] 배포 아키텍처

v2 §21의 배포 항목(Vercel/Cloudflare)을 다음으로 대체한다.

```text
Frontend   : GitHub Pages (정적 대시보드, siren911.github.io 산하)
Database   : Supabase (PostgreSQL, 무료 티어, 프론트는 anon key 읽기 전용)
Collector  : GitHub Actions (cron 30~60분 주기, Secrets에 API 키 보관)
Alert      : GitHub Actions 내 웹훅 발송 (ALERT_WEBHOOK_URL)
```

## 6.1 데이터 흐름

1. Actions cron 실행 → 소스 API 수집 → Claude API 분류 → Supabase 저장
2. 대시보드 로드 시 Supabase에서 최신 데이터 fetch → 마지막 수집 시각 표시
3. 마지막 수집이 2시간 초과 시 `STALE`, fetch 실패 시 `OFFLINE` 표시

## 6.2 보안 규칙

- 모든 write용 키(service_role, Claude, Reddit, 검색 API)는 GitHub Secrets에만 존재한다.
- 프론트 번들에는 Supabase URL + anon key만 포함하며, Row Level Security로 읽기 전용을 강제한다.
- Actions 로그에 원문·키가 출력되지 않도록 마스킹한다.

---

# 7. [확정] 도구·모델 전략

## 7.1 개발 도구

| 단계 | 도구 | 모델 |
|---|---|---|
| Phase 1 (DEMO 대시보드) | Claude 앱 (Artifact) | Claude Fable 5 |
| Phase 2~4 (저장소·커넥터·운영) | Claude Code | Claude Fable 5 |

## 7.2 앱 런타임 파이프라인 모델 매핑 (Phase 2)

| Stage | 역할 | 모델 | 근거 |
|---|---|---|---|
| Stage 0 | 결정적 프리필터 | 모델 미사용 (코드) | 비용 0 |
| Stage 1 | 관련성·Claim 추출 | claude-haiku-4-5 | 전체 게시글 대상, 최저 비용 |
| Stage 2 | 기술 분류 | claude-sonnet-4-6 | 관련성 0.70 이상만, 비용·품질 균형 |
| Stage 3 | 고위험 재판정 | claude-opus-4-8 | Severity 4~5, Data Integrity 등 소량 정밀 |
| 요약 | 경영진 요약·번역 | claude-sonnet-4-6 | 일 1~2회 배치 |

- Fable 5는 개발용으로 사용하고, 런타임 파이프라인에는 위 3종을 사용해 비용을 통제한다.
- prompt version과 model id를 `model_runs` 테이블에 저장한다 (v2 §49.7 유지).

---

# 8. [개정] Phase 1 완료 기준 (축소판)

v2 §66 평가표는 최종(Phase 4) 기준으로 유지하고, Phase 1은 다음만 충족하면 완료로 본다.

- [ ] 모바일·데스크톱 반응형으로 렌더링된다
- [ ] Executive / Analyst 뷰 전환이 작동한다
- [ ] 필터(지역·용량·펌웨어·카테고리·severity)·검색·정렬이 작동한다
- [ ] 이슈 상세와 Evidence Drawer에서 출처 URL까지 내려갈 수 있다
- [ ] CSV 내보내기가 작동한다
- [ ] 모든 데이터에 `DEMO DATA` 배지가 표시되고 LIVE로 오인할 수 없다
- [ ] 확정 표현(confirmed defect 등)이 화면 어디에도 없다
- [ ] localStorage를 사용하지 않는다

---

# 9. Phase 1 시작 명령 (Claude 앱에 입력)

```text
v2 스펙과 v3 Amendment를 함께 Source of Truth로 사용하라. 충돌 시 v3 우선.
v3 §1.1 스코프만 구현하고 §1.2는 구현하지 마라.
단일 HTML Artifact로 Phase 1 DEMO 대시보드를 제작하라.
디자인은 반도체 품질 상황실 톤의 전문 도구로 하되 Samsung 공식 서비스로 오인되지 않게 하라.
완료 후 v3 §8 체크리스트로 자체 검증 결과를 보고하라.
```
