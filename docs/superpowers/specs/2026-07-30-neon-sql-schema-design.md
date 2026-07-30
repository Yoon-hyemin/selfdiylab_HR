# 인사 프로그램 SQL 데이터베이스 재구축 설계

- 작성일: 2026-07-30
- 관련 파일: `hr-system.html`, `apply-landing.html`, `index.html`, `job-detail.html`

## 배경

기존 `hr-system.html`은 모든 데이터를 브라우저 `localStorage`에만 저장하는 정적 목업이라, 다른 기기/사용자와 데이터가 공유되지 않고 홈페이지와도 연동되지 않는다. `apply-landing.html`의 지원서 제출 버튼도 실제 저장 로직이 없다.

이 문서는 기존 목업의 데이터 구조(`hr-system.html` 내 `seedData()`)를 그대로 유지하면서, 실제 운영 가능한 Neon(PostgreSQL) 데이터베이스와 Vercel 서버리스 API로 교체하는 설계를 정리한다.

## 범위

- DB 스키마 설계 + 실제 연동까지 (프론트엔드 파일들을 API 호출로 전환)
- 로그인/권한 관리는 이번 범위에서 제외 (다음 단계 과제)
- 대상 도메인: 구성원(members), 채용공고(jobs), 지원자(candidates), OKR, 평가(evals), 캘리브레이션(calibration), 1:1 미팅(oneonones), 공휴일(holidays, 신설)

## 아키텍처

```
정적 HTML (hr-system.html, apply-landing.html, index.html, job-detail.html)
        │  fetch()
        ▼
Vercel Serverless Functions (/api/*.js)
        │  @neondatabase/serverless
        ▼
Neon Postgres
```

- 기존 4개 HTML 파일은 유지하고 `/api` 폴더에 서버리스 함수를 추가한다.
- Vercel↔Neon 공식 연동을 사용해 `DATABASE_URL` 환경변수를 자동 주입받는다.
- 인증 없이 공개 엔드포인트로 시작한다 (내부망/관리자 전용 사용을 전제).

### API 계약 설계 원칙

`hr-system.html`은 현재 하나의 중첩된 JS 객체(`DB`)를 통째로 다루는 구조다. DB 자체는 아래처럼 정규화하되, API 응답/요청 형태는 기존 중첩 객체 모양을 최대한 유지한다 (예: `GET /api/members/:id`는 휴직이력/포상/경력 등을 배열로 포함해 한 번에 반환). 서버가 이 중첩 JSON과 정규화된 테이블 사이의 변환을 담당하므로, 프론트엔드 코드는 `localStorage` 호출을 `fetch` 호출로 바꾸는 최소한의 수정만 필요하다.

## 데이터 스키마

### members (구성원 기본정보)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid, PK | |
| name | text | |
| nickname | text | |
| team | text | |
| position | text | |
| email | text | |
| personal_email | text | |
| employee_no | text | |
| hire_date | date | |
| group_hire_date | date | |
| hire_type | text | |
| rrn | text | 주민번호 — 민감정보, 추후 암호화/마스킹 검토 |
| birthday | date | |
| phone | text | |
| address | text | |
| labor_contract | text | |
| wage_contract | text | |
| salary_pay_info | text | |
| work_type_name | text | |
| work_type_fixed | boolean | |
| work_type_hours | text | |
| overtime_policy | text | |
| leave_policy_basis | text | |
| leave_policy_half_day | text | |
| leave_policy_promotion | text | |
| hr_info | text | |
| intro | text | |
| worked_hours | text | |
| leave_left | text | |
| special_notes | text | |
| deduction_basic | integer | |
| deduction_health_dependents | integer | |
| created_at / updated_at | timestamptz | |

### member_leave_history / member_awards / member_discipline / member_career / member_education / member_family
공통 패턴: `id` PK, `member_id` FK → `members(id)` (on delete cascade), 그 외 목업의 필드 그대로
(예: `member_career`는 `company`, `role`, `period`)

### holidays (신설 — 기존엔 구성원마다 중복 저장되던 공휴일을 회사 전체 공유 테이블로 분리)
| 컬럼 | 타입 |
|---|---|
| id | serial, PK |
| name | text |

### jobs (채용공고)
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid, PK | |
| title | text | |
| team | text | |
| deadline | date | |
| status | text | |
| stages | jsonb | 진행 단계 목록 (공고마다 자유 구성) |
| submission_docs | jsonb | 제출서류 목록 |
| pre_questions | jsonb | 사전질문 목록 |
| extra_info | jsonb | 학력/경력/병역 등 플래그 |
| created_at / updated_at | timestamptz | |

### candidates (지원자)
| 컬럼 | 타입 |
|---|---|
| id | uuid, PK |
| job_id | FK → jobs(id) |
| name | text |
| phone | text |
| stage | text |
| created_at | timestamptz |

### candidate_history
`id` PK, `candidate_id` FK → `candidates(id)`, `date`, `stage`, `note`

### okrs
| 컬럼 | 타입 | 비고 |
|---|---|---|
| id | uuid, PK | |
| quarter | text | 예: '2026-Q3' |
| level | text | '회사'/'조직'/'개인' |
| title | text | |
| owner | text | 팀명 또는 개인명 텍스트 (목업 값 유지) |
| parent_id | FK → okrs(id), nullable | 자기참조 |
| progress | integer | |
| unit | text | |
| target | integer | |

### evals (평가) — 기존엔 `employee` 이름 문자열, 신설 구조에서는 FK로 변경
| 컬럼 | 타입 |
|---|---|
| id | uuid, PK |
| quarter | text |
| employee_id | FK → members(id) |
| common / lead / job / performance / custom | integer |
| strength | text |
| improve | text |

### calibration_cycles / calibration_overrides
- `calibration_cycles`: `quarter` PK, `target_s`, `target_a`, `target_b`, `target_c`, `target_d` (integer)
- `calibration_overrides`: `id` PK, `quarter` FK → `calibration_cycles(quarter)`, `employee_id` FK → `members(id)`, `grade`

### oneonones — 기존엔 `employee` 이름 문자열, 신설 구조에서는 FK로 변경
`id` PK, `employee_id` FK → `members(id)`, `date`, `note`

## 초기 데이터 (시드)

DB 생성 직후 마이그레이션으로 기존 `hr-system.html`의 샘플 5명(김서연, 박준혁, 이하은, 최지우, 이도현)과 채용공고 2건, 지원자 3명, OKR/평가/1:1 샘플을 그대로 넣는다. 목적은 화면이 기존 목업과 동일하게 보이는지 바로 검증하기 위함.

## 프론트엔드 변경 범위

- `hr-system.html`: `loadData()`/`saveData()`가 `localStorage` 대신 `/api/*` 호출을 사용하도록 교체. 화면/상호작용 로직은 그대로 유지.
- `apply-landing.html`: 지원서 제출 버튼에 실제 `POST /api/jobs/:id/candidates` 호출 연결.
- `index.html`, `job-detail.html`: 필요한 범위 내에서 동일한 API를 참조하도록 연동 (현재 정적 목업 데이터를 실제 데이터로 교체).

## 인증/권한

이번 범위에는 포함하지 않는다. API는 공개 엔드포인트로 열어두고, 추후 별도 작업으로 로그인/권한을 추가한다.

## 확장성 확인

스키마는 특정 인원 수에 종속되지 않는다 — 구성원/채용공고/지원자/OKR/평가/1:1 모두 테이블에 행을 추가하는 방식이므로, 초기 5명 샘플 이후 몇 명을 추가하든 동일하게 동작한다.

## 리스크 / 후속 과제

- `rrn`(주민번호) 등 민감정보를 평문으로 저장하는 부분은 실제 운영 전 암호화 또는 접근 제어 검토 필요 (이번 범위 밖).
- 인증 없는 공개 API는 외부 노출 시 위험 — 실제 배포 URL을 외부에 공유하지 않거나, 다음 단계에서 반드시 권한 관리를 추가해야 함.
