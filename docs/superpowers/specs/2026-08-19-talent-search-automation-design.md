# 인재검색 자동화 — HR 시스템 통합 설계 (Phase 0)

- 작성일: 2026-08-19
- 원본 명세: `인재검색_자동화_마스터프롬프트_원본.md` (사용자가 GPT로 작성한 전체 제품 명세, 원문 그대로 보관 — 채점표·Phase별 완료기준·화면 세부사항·테스트 요구사항은 그 문서가 1차 출처이며, 이 설계 문서는 "셀디랩 HR 시스템에 통합"이라는 이번 결정에 맞춰 아키텍처를 각색한 것)
- 관련 기존 파일: `sql/012_accounts_and_audit.sql`(계정·감사로그), `handlers/_lib/accountAuth.js`, `handlers/jobs/*`, `handlers/candidates/*`(이번 기능과 이름은 비슷하지만 용도가 다른 기존 채용 지원자 관리 기능 — 아래 "기존 채용 기능과의 구분" 참고), `index.html`(사이드바·SPA)

## 배경

원본 문서는 로컬 전용 프로그램(SQLite + Electron + Chrome 확장)으로 처음부터 끝까지 독립적으로 설계돼 있었다. 사용자(윤혜민)와의 대화에서 다음 3가지를 확정했고, 이 문서는 그 결정을 반영해 아키텍처를 다시 짠 것이다.

1. 이 기능을 **지금 이 저장소(셀디랩 HR 시스템) 안에 통합**한다.
2. **검색·평가 실행 엔진만 로컬 프로그램**으로 분리하고, 그 외(검색 프로젝트 관리, 기준 설정·승인, 진행 상황, 추천 결과 보기)는 **기존 HR 웹사이트(Vercel + Neon)**에 그대로 통합한다.
3. **여러 컴퓨터에서 각자 실행 엔진을 돌릴 수 있어야 한다** — 채용 플랫폼 기업회원 계정은 팀 공용 계정 하나를 여러 사람이 돌아가며 쓴다.

이 결정에 따라 원본 문서 대비 다음이 바뀐다:

| 항목 | 원본 문서 | 이번 설계 |
|---|---|---|
| DB | SQLite(로컬, 컴퓨터별 개별) | **기존 Neon Postgres 재사용** — 여러 컴퓨터가 동시에 검색해도 하나의 데이터로 합쳐짐 |
| 검색 프로젝트/기준 관리/결과 조회 화면 | 별도 로컬 웹앱(React+Vite) | **기존 HR 웹사이트(`index.html`)에 새 메뉴로 통합**, `handlers/`에 새 API 추가 |
| 최종 데스크톱 패키징(Electron) | Phase 3 이후 검토 | 보류 — 실행 엔진은 우선 Node.js 백그라운드 프로그램으로, 필요해지면 나중에 패키징 검토 |
| 권한 | 명시 없음("승인된 채용담당자") | 기존 계정 시스템에 **`can_use_talent_search` 플래그** 추가 (ADMIN은 항상 접근 가능) |
| 플랫폼 계정 동시 사용 | 명시 없음 | **플랫폼별 사용 잠금** 화면 추가 — 기업회원 계정 하나를 여러 컴퓨터가 동시에 쓰다 세션이 끊기는 걸 방지 |

채점 로직(Level 1, 공통 40점, 직무 60점, 판정 상태, 중복 처리 등)과 안전 원칙(발송 금지, CAPTCHA 우회 금지, 개인정보 최소수집 등)은 원본 문서 2~10장 그대로 유지한다 — 이 문서에서 다시 반복하지 않는다.

## 기존 채용 기능과의 구분

저장소에 이미 `jobs`/`candidates`/`candidate_history` 테이블과 `handlers/jobs/*`, `handlers/candidates/*`가 있다. 이건 **"지원자가 우리 채용공고에 지원 → 접수/서류/면접 단계 관리"**하는 정반대 방향의 기능이다. 이번 기능은 **"우리가 먼저 인재풀에서 찾아서 평가"**하는 소싱(sourcing) 기능이라 데이터 흐름이 다르다. 이름 충돌을 피하려고 새 테이블은 전부 `talent_search_` 접두사를 쓴다.

## 전체 아키텍처

```
[혜민님 PC]                    [다른 팀원 PC]
 실행기(Node.js 백그라운드)      실행기
 + 크롬 확장(Manifest V3)        + 크롬 확장
      │                              │
      └──────────┬───────────────────┘
                 │  HR 사이트 계정으로 로그인 → API 호출
                 ▼
      HR 웹사이트 (Vercel, api/[...path].js → handlers/talent-search/*)
                 │
                 ▼
      Neon Postgres (기존 DB, talent_search_* 테이블 추가)
```

- 실행기는 **기준·검색 프로젝트를 만들지 않는다** — HR 웹사이트에서 승인된 프로젝트/기준 버전을 API로 읽어오기만 한다.
- 실행기가 찾은 후보자·평가 결과·체크포인트는 API로 그대로 Neon에 저장 — 웹사이트는 실시간으로 같은 데이터를 보여준다.
- 실행기의 HR 사이트 인증 방식(세션 쿠키 재사용 vs 별도 API 토큰)은 실행기를 실제로 만드는 **Phase 3에서 확정**한다 — Phase 1~2는 실행기 자체가 없으므로 지금 결정할 필요가 없다.

## 권한

기존 `accounts.system_role`(ADMIN/DEPARTMENT_HEAD/EMPLOYEE)과 별개 축으로 컬럼 하나를 추가한다.

```sql
ALTER TABLE accounts ADD COLUMN can_use_talent_search boolean NOT NULL DEFAULT false;
```

- **ADMIN**: 이 값과 무관하게 항상 접근 가능 (기존 원칙 — ADMIN은 부서장 전용 기능도 전부 접근 가능하던 것과 동일)
- **그 외**: `can_use_talent_search = true`인 계정만 사이드바에 "인재검색" 메뉴가 보임
- "계정 및 권한 관리" 화면(ADMIN 전용)에 "인재검색 권한" 체크박스 추가 — DEPARTMENT_HEAD 옵션 옆 설명 문구와 같은 패턴으로 안내 문구 추가
- 이 값 변경도 기존 `audit_log`에 기록 (권한 변경 감사 로그 패턴 재사용)

## 데이터 모델

아래는 설계 시점의 목표 스키마다. 정확한 컬럼은 Phase 1의 각 소단계(1B/1C/1D/1E)를 실제로 구현할 때 마이그레이션 파일로 확정한다 — 여기서는 테이블 간 관계와 무엇을 담는지를 확정한다.

### ① 검색 조건 관련

```sql
-- 검색 프로젝트
CREATE TABLE talent_search_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  role_title text NOT NULL,
  seniority_level text,
  experience_min_years numeric,
  experience_max_years numeric,
  employment_type text,
  headcount integer,
  location text,
  work_conditions jsonb DEFAULT '{}',
  natural_language_brief text,
  target_recommend_count integer NOT NULL,
  daily_recommend_cap integer NOT NULL DEFAULT 50,
  platforms jsonb NOT NULL DEFAULT '[]',  -- ['saramin','jobkorea','remember','wanted'] 중 선택
  status text NOT NULL DEFAULT 'draft',    -- draft | criteria_approved | active | paused | completed
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 기준 버전 (프로젝트마다 여러 버전 — 기준을 고쳐도 과거 평가는 그때 버전 유지)
CREATE TABLE talent_search_criteria_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id),
  version_no integer NOT NULL,
  summary text,
  must_conditions jsonb NOT NULL DEFAULT '[]',
  core_conditions jsonb NOT NULL DEFAULT '[]',
  nice_conditions jsonb NOT NULL DEFAULT '[]',
  exclude_conditions jsonb NOT NULL DEFAULT '[]',
  keyword_groups jsonb NOT NULL DEFAULT '{}',   -- must/or/exact/exclude/nice + 자동 확장 동의어
  platform_queries jsonb NOT NULL DEFAULT '{}', -- 플랫폼별 검색어 미리보기
  job_fit_template jsonb NOT NULL DEFAULT '[]', -- 직무 60점 세부기준(상위영역/배점/필수-우대-제외)
  status text NOT NULL DEFAULT 'draft',  -- draft | approved | superseded
  approved_by uuid REFERENCES accounts(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, version_no)
);

-- 회사 전체 공용 정책(Level1 문턱값 + 공통 40점 배점 + 근거계수 + 임계값). 프로젝트와 무관, 관리자 전용
CREATE TABLE talent_search_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level1_rules jsonb NOT NULL,       -- 업데이트기간 구간, 단기근속 개월수/횟수/예외사유, 공백기간 구간
  common_fit_weights jsonb NOT NULL, -- 5개 항목명+배점, 합계 40 검증
  evidence_coefficients jsonb NOT NULL, -- {none:0.5, weak:0.65, partial:0.8, clear:1.0}
  rounding_rule jsonb NOT NULL,      -- 0.5점 단위, 정확히 중간이면 올림
  thresholds jsonb NOT NULL,         -- 총점70, 직무42, 의미있는 근거 최소개수 등
  sort_tiebreak_rules jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft | active | superseded
  change_reason text,
  created_by uuid REFERENCES accounts(id),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 재사용 가능한 직무 템플릿
CREATE TABLE talent_search_role_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  job_fit_template jsonb NOT NULL,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
```

### ② 검색 진행 관련

```sql
CREATE TABLE talent_search_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  platform_candidate_ref text NOT NULL,  -- 플랫폼 내부 식별자 또는 해시
  display_name text,
  current_title text,
  current_company text,
  total_experience_months integer,
  related_experience_months integer,
  seniority_level text,
  location text,
  resume_updated_at date,
  core_tasks jsonb DEFAULT '[]',
  achievements jsonb DEFAULT '[]',
  tools jsonb DEFAULT '[]',
  industries jsonb DEFAULT '[]',
  has_portfolio boolean,
  source_url text,
  duplicate_status text NOT NULL DEFAULT 'none', -- none | possible | confirmed | merged
  merged_into_candidate_id uuid REFERENCES talent_search_candidates(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(platform, platform_candidate_ref)
);

-- 목록 1차 선별 결과
CREATE TABLE talent_search_list_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES talent_search_candidates(id),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id),
  criteria_version_id uuid NOT NULL REFERENCES talent_search_criteria_versions(id),
  status text NOT NULL, -- open_detail | review_uncertain | skip_clear_mismatch
  reason text,
  list_fields_used jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 최종 평가 (후보 x 프로젝트 x 기준버전 조합별로 저장 — 재사용 안 함)
CREATE TABLE talent_search_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES talent_search_candidates(id),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id),
  criteria_version_id uuid NOT NULL REFERENCES talent_search_criteria_versions(id),
  policy_version_id uuid NOT NULL REFERENCES talent_search_policy_versions(id),
  level1_status text NOT NULL,  -- pass | verify | fail
  level1_reasons jsonb,
  common_fit_score numeric NOT NULL,
  common_fit_evidence jsonb NOT NULL,  -- 항목별 {score, label, evidenceText, sourceSection}
  job_fit_score numeric NOT NULL,
  job_fit_evidence jsonb NOT NULL,
  total_score numeric NOT NULL,
  evidence_coverage text NOT NULL, -- high | medium | low
  recommendation_status text NOT NULL, -- recommended | needs_verification | rejected
  reject_reasons jsonb,
  model_version text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, project_id, criteria_version_id)
);

-- 검색 배치 실행 이력
CREATE TABLE talent_search_platform_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id),
  platform text NOT NULL,
  batch_type text NOT NULL, -- exact | synonym | adjacent | expanded
  query_used jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  discovered_count integer DEFAULT 0,
  new_count integer DEFAULT 0,
  duplicate_rate numeric,
  detail_viewed_count integer DEFAULT 0,
  recommended_count integer DEFAULT 0,
  top_exclude_reasons jsonb,
  last_page_cursor text,
  run_by uuid REFERENCES accounts(id)
);

-- 이어서 검색용 체크포인트 (프로젝트 x 플랫폼 단위 1행)
CREATE TABLE talent_search_checkpoints (
  project_id uuid NOT NULL REFERENCES talent_search_projects(id),
  platform text NOT NULL,
  last_candidate_ref text,
  queue_state jsonb,
  daily_counts jsonb,       -- Asia/Seoul 날짜 기준
  cumulative_counts jsonb,
  last_success_at timestamptz,
  pause_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, platform)
);

-- 플랫폼별 실시간 사용 잠금 (동시 로그인 세션 충돌 방지용 표시)
CREATE TABLE talent_search_platform_locks (
  platform text PRIMARY KEY,
  held_by uuid REFERENCES accounts(id),
  project_id uuid REFERENCES talent_search_projects(id),
  held_since timestamptz
);
```

### ③ 관리용

```sql
CREATE TABLE talent_search_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES talent_search_candidates(id),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id),
  feedback text NOT NULL, -- fit | hold | reject
  reason text,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE talent_search_quality_audit_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES talent_search_candidates(id),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id),
  sample_reason text NOT NULL, -- near_threshold | low_info | auto_excluded
  created_at timestamptz NOT NULL DEFAULT now()
);
```

감사 로그는 새로 만들지 않고 기존 `audit_log` 테이블에 이벤트 타입만 추가한다(기준 변경, 권한 변경, 수동 병합, 발송 시도 차단 등).

## 화면 구성 (HR 웹사이트에 추가)

사이드바에 **"인재검색"** 메뉴 추가(권한: ADMIN 또는 `can_use_talent_search=true`). 하위 화면:

| 화면 | Phase |
|---|---|
| 대시보드 (진행중/일시정지/완료 프로젝트, 오늘 추천 현재/50, 누적 추천 현재/목표) | 1A |
| 기준 관리센터 (Level1, 공통40점, 직무60점 템플릿, 임계값, 하루상한 — 관리자 전용) | 1B |
| 새 인재검색 (자연어 입력 + 조건) | 1C |
| 기준 확인·승인 | 1D |
| 실시간 검색 진행 (+ 플랫폼 사용 잠금 표시) | 1E |
| 추천 후보 목록 / 후보 상세 평가 | 1F |
| 관리 영역 (정보부족, 제외사유 집계, 중복검토, 커넥터 상태) | 1F~1G |
| 직무 템플릿 관리 | 1B~1C |
| 검색범위 보고서 | 1E~1G |

각 화면의 세부 요구사항(카드 구성, 정렬 규칙, 표시 문구 등)은 원본 문서 12.3절(A~J)을 그대로 따른다.

## Phase 순서

원본 문서의 Phase 0~5 골격은 유지하되, Phase 1은 "가짜 로컬 웹앱"이 아니라 **실제 HR 웹사이트 화면**으로 바로 만든다 (SQLite 대신 Neon을 처음부터 쓰므로 "로컬 시뮬레이션 → 나중에 실제 사이트로 이관" 단계가 필요 없어짐).

- **Phase 0** (이 문서) — 완료
- **Phase 1** — HR 웹사이트에 인재검색 화면 전체를 가상/시뮬레이션 데이터로 완성. 실행기·크롬 확장·로컬 AI·실제 플랫폼 접속은 전혀 없음. 소단계:
  - **1A**: 사이드바 메뉴, 대시보드 빈 상태 + 가상 프로젝트 카드 2개, 권한 플래그(`can_use_talent_search`) 적용
  - **1B**: 기준 관리센터 (Level1/공통40점/직무60점/임계값/하루상한 편집 + 버전이력 + 가상 후보 영향 미리보기)
  - **1C**: 새 인재검색 입력 화면 (자연어 + 조건 폼, AI 연결 전이므로 구조화는 목업 응답으로 시뮬레이션)
  - **1D**: 기준 확인·승인 화면
  - **1E**: 검색 진행 시뮬레이션 (가상 후보 100명 생성, 진행상태, 체크포인트, 플랫폼 사용 잠금 표시)
  - **1F**: 추천 후보 목록 + 상세 평가 화면
  - **1G**: 통합 검증 (Neon 저장 확인, 기준 버전 변경 전후 비교, 전체 재현 테스트)
- **Phase 2** — 로컬 AI(Ollama) 연결: 자연어 구조화, 이력서 추출, 품질 게이트, 기준 보정 화면
- **Phase 3** — 실행기 프로그램 + 크롬 확장 뼈대 최초 제작, **사람인만** 실제 연동 (수동 이동 + 자동 추출·평가), 실행기의 HR 사이트 인증 방식 확정
- **Phase 4** — 잡코리아·리멤버·원티드 순서로 추가
- **Phase 5** — 여러 컴퓨터 동시운영 안정화, 장시간 실행, 운영 매뉴얼

각 Phase/소단계 종료 시 원본 문서 17장의 보고 형식(구현 내용/실제 화면/테스트 결과/남은 위험/다음 착수조건)을 그대로 따른다.

## 이번 설계에서 다루지 않는 것 (명시적 제외)

- 실행기 프로그램과 크롬 확장의 실제 코드 (Phase 3)
- 로컬 AI 연결 (Phase 2)
- 실제 채용 플랫폼 접속, 선택자 매핑 (Phase 3~4)
- Electron 패키징 여부 결정 (Phase 3 이후 재검토)
- 실행기의 정확한 인증 방식(세션 쿠키 재사용 vs API 토큰) — Phase 3에서 확정

## 리스크 / 후속 확인 사항

- **플랫폼 계정 동시 사용 충돌**: 기업회원 계정 하나를 여러 컴퓨터가 쓰므로, 같은 플랫폼을 동시에 두 곳에서 로그인하면 세션이 끊길 수 있다. "플랫폼 사용 잠금" 표시로 완화하지만, 실제 플랫폼이 동시 로그인을 어떻게 처리하는지는 Phase 3에서 사람인으로 실제 검증 필요.
- **Neon 무료 요금제 용량**: 여기서 "수백~수천"은 프로그램 이용자 수가 아니라 **검토·저장되는 후보자 레코드 수**를 뜻한다(채용 건 하나당 목록 확인~상세 열람 단계에서 수백~1,000명 단위가 쌓임). 후보자 1명당 데이터(이력서 요약+평가 근거문장)는 대략 몇 KB 수준이라, 채용 건 여러 개를 누적해도 당분간 Neon 무료 용량에 여유가 있을 것으로 추정된다. 원본 문서 14장에 이미 있는 "데이터 보관기간 설정 + 프로젝트별 삭제 기능"으로 오래된 완료 건을 정리하면 되므로, 지금 시점에 구조를 바꿔야 하는 위험은 아니고 "몇 년 누적 후 필요하면 정리하거나 유료 전환" 정도의 참고사항이다.
- **로컬 PC 사양**: Ollama로 로컬 AI를 돌리려면 각 컴퓨터가 어느 정도 사양(권장 램 16GB 이상)이 돼야 응답 속도가 괜찮다. 팀원 컴퓨터 사양 확인 필요 (Phase 2 착수 전).
- **채용 플랫폼 이용약관·이용권 차감**: 원본 문서 8.1절 원칙(수동보조 기본, 이용권 차감 불명확 시 중단)을 그대로 따르되, 사람인부터 실제 화면으로 확인이 필요 (Phase 3).
- **권한 플래그 이름**: `can_use_talent_search`는 가칭 — 실제 계정 관리 화면 구현 시(1A) 확정.
