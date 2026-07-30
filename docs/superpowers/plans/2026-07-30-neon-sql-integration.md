# 인사 프로그램 Neon SQL 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `hr-system.html`, `apply-landing.html`을 브라우저 `localStorage` 대신 Neon(PostgreSQL) 데이터베이스와 Vercel 서버리스 API로 실제 연동한다.

**Architecture:** 정적 HTML(`hr-system.html`, `apply-landing.html`)이 `fetch()`로 Vercel 서버리스 함수(`/api/*`)를 호출하고, 그 함수들이 `@neondatabase/serverless` 드라이버로 Neon Postgres에 직접 쿼리한다. 여러 명이 동시에 각자 다른 항목을 수정할 수 있어야 하므로, 항목(구성원 1명, 채용공고 1건 등) 단위로 저장되는 REST 엔드포인트로 설계했다 (전체를 통째로 덮어쓰는 방식은 채택하지 않음).

**Tech Stack:** Neon Postgres, Vercel Serverless Functions (Node.js, ESM), `@neondatabase/serverless`, 순수 HTML/JS (프레임워크 없음)

## Global Constraints

- 이번 범위는 로그인/권한 관리를 포함하지 않는다 (스펙 문서 참고: `docs/superpowers/specs/2026-07-30-neon-sql-schema-design.md`).
- 자동화 테스트는 별도 테스트용 DB가 없으므로, 각 API 태스크의 "테스트"는 `vercel dev`로 로컬 서버를 띄운 뒤 실제 Neon 개발 DB에 대고 curl로 요청을 보내 응답을 확인하는 방식으로 한다. 테스트가 만든 데이터는 각 태스크의 마지막 단계에서 직접 정리(삭제)한다.
- SQL 마이그레이션 파일은 Neon 콘솔의 SQL Editor에 붙여넣어 직접 실행한다 (에이전트가 DB 자격증명에 접근하지 않는다).
- 이력서 파일 업로드, `job-detail.html` 연동, `index.html` 연동은 이번 범위에서 제외한다 (사용자와 합의됨).
- 이번 라운드부터 `hr-system.html`의 "전체 데이터 가져오기(JSON)"/"전체 초기화" 기능은 지원하지 않는다 — 항목별 저장 구조로 바뀌면서 통째 교체가 더 이상 안전하지 않기 때문. 버튼은 안내 문구만 띄우도록 바꾼다.

---

## Task 1: 프로젝트 스캐폴딩 & Neon 연결 헬퍼

**Files:**
- Modify: `package.json`
- Create: `.env.local.example`
- Create: `.gitignore`
- Create: `api/_lib/db.js`

**Interfaces:**
- Produces: `sql` (named export from `api/_lib/db.js`) — a tagged-template/parameterized query function from `@neondatabase/serverless`, used by every later API file: `import { sql } from '../_lib/db.js'` (경로는 파일 위치에 따라 `../` 개수 조정).

- [ ] **Step 1: `package.json`에 의존성 추가**

`package.json`을 다음으로 교체한다 (기존 `jsdom` 의존성 유지):

```json
{
  "type": "module",
  "dependencies": {
    "@neondatabase/serverless": "^0.10.4",
    "jsdom": "^30.0.0"
  }
}
```

- [ ] **Step 2: 의존성 설치**

Run: `npm install`
Expected: `node_modules/@neondatabase` 폴더가 생기고 에러 없이 종료됨

- [ ] **Step 3: 환경변수 예시 파일 작성**

`.env.local.example` 생성:

```
DATABASE_URL=postgresql://user:password@ep-example-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
```

실제 값은 Neon 콘솔의 Connection String을 복사해서 `.env.local`(git에 올리지 않는 파일)에 붙여넣는다. `vercel dev` 실행 시 자동으로 로드된다. Vercel에 배포할 때는 Vercel 프로젝트 설정의 Neon 통합을 연결하면 같은 값이 자동으로 주입된다.

- [ ] **Step 4: `.gitignore` 작성**

```
node_modules/
.env.local
.vercel/
```

- [ ] **Step 5: DB 연결 헬퍼 작성**

`api/_lib/db.js`:

```js
import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set. Copy .env.local.example to .env.local and fill in your Neon connection string.');
}

export const sql = neon(process.env.DATABASE_URL);
```

- [ ] **Step 6: 연결 확인**

`.env.local`에 실제 `DATABASE_URL`을 채운 뒤 실행:

Run: `node -e "import('./api/_lib/db.js').then(({sql}) => sql\`SELECT 1 as ok\`).then(r => console.log(r))"`

Expected: `[ { ok: 1 } ]` 출력. `DATABASE_URL` 관련 에러가 나면 `.env.local` 값을 다시 확인.

- [ ] **Step 7: Commit**

```bash
git init
git add package.json package-lock.json .env.local.example .gitignore api/_lib/db.js
git commit -m "chore: scaffold Neon connection and project config"
```

(이 프로젝트는 아직 git 저장소가 아니므로 `git init`을 함께 실행한다. 이미 초기화되어 있다면 `git init`은 생략.)

---

## Task 2: SQL 스키마 마이그레이션

**Files:**
- Create: `sql/001_schema.sql`

**Interfaces:**
- Produces: `members`, `member_leave_history`, `member_awards`, `member_discipline`, `member_career`, `member_education`, `member_family`, `holidays`, `jobs`, `candidates`, `candidate_history`, `okrs`, `evals`, `calibration_cycles`, `calibration_overrides`, `oneonones` 테이블 — 이후 모든 API 태스크가 이 테이블에 쿼리한다.

- [ ] **Step 1: 스키마 파일 작성**

`sql/001_schema.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  nickname text DEFAULT '',
  team text DEFAULT '',
  position text DEFAULT '',
  email text DEFAULT '',
  personal_email text DEFAULT '',
  employee_no text DEFAULT '',
  hire_date date,
  group_hire_date date,
  hire_type text DEFAULT '',
  rrn text DEFAULT '',
  birthday date,
  phone text DEFAULT '',
  address text DEFAULT '',
  labor_contract text DEFAULT '',
  wage_contract text DEFAULT '',
  salary_pay_info text DEFAULT '',
  work_type_name text DEFAULT '',
  work_type_fixed boolean DEFAULT true,
  work_type_hours text DEFAULT '',
  overtime_policy text DEFAULT '',
  leave_policy_basis text DEFAULT '',
  leave_policy_half_day text DEFAULT '',
  leave_policy_promotion text DEFAULT '',
  hr_info text DEFAULT '',
  intro text DEFAULT '',
  worked_hours text DEFAULT '',
  leave_left text DEFAULT '',
  special_notes text DEFAULT '',
  deduction_basic integer DEFAULT 1,
  deduction_health_dependents integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE member_leave_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reason text DEFAULT '',
  period text DEFAULT ''
);

CREATE TABLE member_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title text DEFAULT '',
  date date
);

CREATE TABLE member_discipline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reason text DEFAULT '',
  date date
);

CREATE TABLE member_career (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  company text DEFAULT '',
  role text DEFAULT '',
  period text DEFAULT ''
);

CREATE TABLE member_education (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  school text DEFAULT '',
  major text DEFAULT '',
  period text DEFAULT ''
);

CREATE TABLE member_family (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name text DEFAULT '',
  relation text DEFAULT ''
);

CREATE TABLE holidays (
  id serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  team text DEFAULT '',
  deadline date,
  status text NOT NULL DEFAULT '진행중',
  stages jsonb NOT NULL DEFAULT '[]',
  submission_docs jsonb NOT NULL DEFAULT '[]',
  pre_questions jsonb NOT NULL DEFAULT '[]',
  extra_info jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text DEFAULT '',
  email text,
  self_intro text,
  stage text NOT NULL DEFAULT '접수',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT current_date,
  stage text,
  note text
);

CREATE TABLE okrs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter text NOT NULL,
  level text NOT NULL,
  title text NOT NULL,
  owner text DEFAULT '-',
  parent_id uuid REFERENCES okrs(id) ON DELETE SET NULL,
  progress integer DEFAULT 0,
  unit text DEFAULT '%',
  target integer DEFAULT 100
);

CREATE TABLE evals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter text NOT NULL,
  employee_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  common integer,
  lead integer,
  job integer,
  performance integer,
  custom integer,
  strength text,
  improve text
);

CREATE TABLE calibration_cycles (
  quarter text PRIMARY KEY,
  target_s integer DEFAULT 10,
  target_a integer DEFAULT 20,
  target_b integer DEFAULT 40,
  target_c integer DEFAULT 20,
  target_d integer DEFAULT 10
);

CREATE TABLE calibration_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter text NOT NULL REFERENCES calibration_cycles(quarter) ON DELETE CASCADE,
  eval_id uuid NOT NULL REFERENCES evals(id) ON DELETE CASCADE,
  grade text NOT NULL,
  reason text DEFAULT '',
  UNIQUE(quarter, eval_id)
);

CREATE TABLE oneonones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date date NOT NULL,
  note text DEFAULT ''
);
```

- [ ] **Step 2: Neon 콘솔에서 실행**

Neon 콘솔 → 해당 프로젝트 → SQL Editor에 `sql/001_schema.sql` 내용 전체를 붙여넣고 실행한다.

- [ ] **Step 3: 테이블 생성 확인**

Neon SQL Editor에서 실행:

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
```

Expected: 위 16개 테이블 이름이 모두 나열됨

- [ ] **Step 4: Commit**

```bash
git add sql/001_schema.sql
git commit -m "feat: add Neon Postgres schema for HR data"
```

---

## Task 3: 시드 데이터 마이그레이션

**Files:**
- Create: `sql/002_seed.sql`

**Interfaces:**
- Consumes: Task 2의 테이블 전체
- Produces: 구성원 5명, 채용공고 2건, 지원자 3명, OKR 3건, 평가 4건, 캘리브레이션 사이클 1건, 1:1 3건, 공휴일 8건 — 이후 프론트엔드 통합 태스크(12~16)에서 화면이 예전 목업과 동일하게 보이는지 확인하는 기준 데이터로 쓰인다.

- [ ] **Step 1: 시드 스크립트 작성**

`sql/002_seed.sql`:

```sql
DO $$
DECLARE
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid;
  j1 uuid; j2 uuid;
  c1 uuid; c2 uuid; c3 uuid;
  o1 uuid; o2 uuid;
BEGIN
  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, overtime_policy, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('김서연','마케팅팀','매니저','seoyeon.kim@selfdiylab.com','2024001','2024-03-04','2024-03-04','정규직','1994-05-12','010-1234-5678','서울시 성동구','무기계약직 근로계약서 (2024.03.04 체결)','연봉제 임금계약 (2026년 갱신)','매월 25일 지급 · 계좌이체','기본 근무유형',true,'주 40시간','기본 초과근무 보상정책 · 포괄 아님 · 사후 정산','입사일 기준 부여','반차 단위 사용','연차 촉진 사용','브랜드 마케팅과 캠페인 기획을 담당하고 있어요.','32시간','8.5일',2,1)
  RETURNING id INTO u1;
  INSERT INTO member_awards (member_id, title, date) VALUES (u1, '2025 상반기 우수사원', '2025-07-01');
  INSERT INTO member_career (member_id, company, role, period) VALUES (u1, '전 직장 A', '마케터', '2021~2024');
  INSERT INTO member_education (member_id, school, major, period) VALUES (u1, 'OO대학교', '경영학', '2016~2020');
  INSERT INTO member_family (member_id, name, relation) VALUES (u1, '김OO', '배우자');

  INSERT INTO members (name, nickname, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, overtime_policy, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('박준혁','준','개발팀','선임','junhyuk.park@selfdiylab.com','2023014','2023-09-18','2023-09-18','정규직','1992-11-02','010-2222-3333','경기도 성남시','무기계약직 근로계약서 (2023.09.18 체결)','연봉제 임금계약','매월 25일 지급 · 계좌이체','선택적 근로시간제',false,'주 40시간','포괄 계약 공제 주기 매달 1일-말일','회계일 기준 부여','반차 단위 사용','연차 촉진 미사용','백엔드 시스템과 사내 HR 시스템 개발을 맡고 있어요.','40시간','11일',1,0)
  RETURNING id INTO u2;
  INSERT INTO member_education (member_id, school, major, period) VALUES (u2, 'OO대학교', '컴퓨터공학', '2015~2019');

  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, overtime_policy, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('이하은','피플팀','매니저','haeun.lee@selfdiylab.com','2022007','2022-01-10','2022-01-10','정규직','1990-02-20','010-4444-5555','서울시 마포구','무기계약직 근로계약서 (2022.01.10 체결)','연봉제 임금계약','매월 25일 지급 · 계좌이체','기본 근무유형',true,'주 40시간','기본 초과근무 보상정책','입사일 기준 부여','반차 단위 사용','연차 촉진 사용','채용과 성과관리 프로세스를 총괄하고 있어요.','40시간','6일',2,1)
  RETURNING id INTO u3;
  INSERT INTO member_leave_history (member_id, reason, period) VALUES (u3, '육아휴직', '2023.05~2023.11');
  INSERT INTO member_career (member_id, company, role, period) VALUES (u3, '전 직장 B', 'HR 담당자', '2018~2022');
  INSERT INTO member_education (member_id, school, major, period) VALUES (u3, 'OO대학교', '심리학', '2012~2016');
  INSERT INTO member_family (member_id, name, relation) VALUES (u3, '이OO', '자녀');

  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, work_type_name, work_type_fixed, work_type_hours, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('최지우','CS팀','담당자','jiwoo.choi@selfdiylab.com','2025003','2025-02-03','2025-02-03','계약직','1997-08-15','010-6666-7777','기본 근무유형',true,'주 40시간','입사일 기준 부여','반차 단위 사용','연차 촉진 미사용','24시간','3일',1,0)
  RETURNING id INTO u4;

  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('이도현','경영지원팀','대표','dohyun.lee@selfdiylab.com','2020001','2020-01-02','2020-01-02','정규직','1988-04-09','010-9999-0000','서울시 강남구','대표 근로계약서','연봉제 임금계약','매월 25일 지급 · 계좌이체','기본 근무유형',true,'주 40시간','입사일 기준 부여','반차 단위 사용','연차 촉진 미사용','SelfDIYLab을 이끌고 있어요.','40시간','15일',1,0)
  RETURNING id INTO u5;

  INSERT INTO holidays (name) VALUES ('1월 1일'),('설날'),('3·1절'),('어린이날'),('현충일'),('광복절'),('추석'),('성탄절');

  INSERT INTO jobs (title, team, deadline, status, stages, submission_docs, pre_questions, extra_info)
  VALUES ('프론트엔드 개발자 (3년 이상)','개발팀','2026-08-15','진행중',
    '["접수","서류심사","실무면접","임원면접","처우협의"]'::jsonb,
    '[{"name":"이력서","required":true},{"name":"포트폴리오","required":false}]'::jsonb,
    '[{"q":"우리 회사에 지원한 이유를 알려주세요","required":true}]'::jsonb,
    '{"education":true,"career":true,"military":false,"veteran":false,"disability":false}'::jsonb)
  RETURNING id INTO j1;

  INSERT INTO jobs (title, team, deadline, status, stages, submission_docs, pre_questions, extra_info)
  VALUES ('HR 매니저 (성과관리 담당)','피플팀','2026-08-10','진행중',
    '["접수","서류심사","실무면접","처우협의"]'::jsonb,
    '[{"name":"이력서","required":true}]'::jsonb,
    '[]'::jsonb,
    '{"education":true,"career":true,"military":false,"veteran":false,"disability":false}'::jsonb)
  RETURNING id INTO j2;

  INSERT INTO candidates (job_id, name, phone, stage) VALUES (j1, '김서연', '010-1234-5678', '서류심사') RETURNING id INTO c1;
  INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES
    (c1, '2026-07-20', '접수', '지원서 접수'),
    (c1, '2026-07-24', '서류심사', '서류심사 진행중');

  INSERT INTO candidates (job_id, name, phone, stage) VALUES (j1, '박준혁', '010-2222-3333', '실무면접') RETURNING id INTO c2;
  INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES
    (c2, '2026-07-18', '접수', '지원서 접수'),
    (c2, '2026-07-22', '서류심사', '서류 통과'),
    (c2, '2026-07-27', '실무면접', '1차 면접 일정 확정');

  INSERT INTO candidates (job_id, name, phone, stage) VALUES (j2, '이하은', '010-4444-5555', '접수') RETURNING id INTO c3;
  INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES
    (c3, '2026-07-25', '접수', '지원서 접수');

  INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target) VALUES
    ('2026-Q3','회사','신뢰받는 채용 브랜드로 성장한다','경영진', NULL, 82, '%', 100) RETURNING id INTO o1;
  INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target) VALUES
    ('2026-Q3','조직','채용 리드타임 30일 이내로 단축','피플팀', o1, 58, '%', 100) RETURNING id INTO o2;
  INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target) VALUES
    ('2026-Q3','개인','전 구성원 목표 등록률 100% 달성','이도현', o2, 95, '%', 100);

  INSERT INTO evals (quarter, employee_id, common, lead, job, performance, custom, strength, improve) VALUES
    ('2026-Q2', u1, 5,4,5,5,4, '목표 초과 달성, 협업 리더십이 뛰어남', '문서화 습관을 조금 더 보완하면 좋겠음'),
    ('2026-Q2', u2, 3,2,3,3,3, '꾸준하고 안정적인 업무 처리', '새로운 시도에 조금 더 적극적이면 좋겠음'),
    ('2026-Q2', u3, 4,3,5,2,4, '문제 해결 역량이 뛰어남', '목표 대비 실행 속도를 높일 필요가 있음'),
    ('2026-Q2', u4, 2,2,2,2,2, '맡은 업무는 성실히 수행함', '역할 재정의 및 집중 코칭이 필요함');

  INSERT INTO calibration_cycles (quarter, target_s, target_a, target_b, target_c, target_d) VALUES ('2026-Q2', 10, 20, 40, 20, 10);

  INSERT INTO oneonones (employee_id, date, note) VALUES
    (u1, '2026-07-05', '2분기 목표 중간 점검, 신규 캠페인 리드 역할 논의'),
    (u2, '2026-07-12', '업무 우선순위 조정, 사이드 프로젝트 관심사 공유'),
    (u1, '2026-07-19', '승진 트랙 관련 피드백 전달');
END $$;
```

- [ ] **Step 2: Neon 콘솔에서 실행**

Neon SQL Editor에 `sql/002_seed.sql` 전체를 붙여넣고 실행한다.

- [ ] **Step 3: 데이터 확인**

```sql
SELECT count(*) FROM members;   -- 5
SELECT count(*) FROM jobs;      -- 2
SELECT count(*) FROM candidates; -- 3
SELECT count(*) FROM okrs;      -- 3
SELECT count(*) FROM evals;     -- 4
SELECT count(*) FROM oneonones; -- 3
SELECT count(*) FROM holidays;  -- 8
```

Expected: 위 주석의 숫자와 일치

- [ ] **Step 4: Commit**

```bash
git add sql/002_seed.sql
git commit -m "feat: add seed data matching the original hr-system.html mockup"
```

---

## Task 4: 읽기 전용 API — `GET /api/all`, `GET /api/public-jobs`

**Files:**
- Create: `api/all.js`
- Create: `api/public-jobs.js`
- Test: `tests/all.test.mjs` (수동 실행용 스모크 테스트, 커밋 대상 아님 — 임시 확인용)

**Interfaces:**
- Consumes: Task 1의 `sql`, Task 2/3의 테이블·데이터
- Produces: `GET /api/all` → `{ members, jobs, candidates, okrs, evals, calibration, oneonones }` (기존 `seedData()`와 동일한 중첩 JS 객체 모양). `GET /api/public-jobs` → `[{id, title, team, deadline, status}]` (공개용, 민감정보 없음). 이 응답 모양은 이후 프론트엔드 태스크(12~16)가 그대로 사용한다.

- [ ] **Step 1: `vercel dev` 실행 준비**

Run: `npx vercel dev --listen 3000`

(최초 실행 시 Vercel 로그인/프로젝트 연결을 묻는다 — 프롬프트를 따라 진행. 이후 태스크에서도 이 명령으로 로컬 서버를 계속 띄워둔다.)

- [ ] **Step 2: `GET /api/all` 실패 확인 (파일 없음)**

Run: `curl -s http://localhost:3000/api/all`
Expected: 404 (파일이 아직 없으므로)

- [ ] **Step 3: `api/all.js` 구현**

```js
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [members, leaveHistory, awards, discipline, career, education, family,
      holidays, jobs, candidates, candidateHistory, okrs, evals, calibrationCycles,
      calibrationOverrides, oneonones] = await Promise.all([
      sql`SELECT * FROM members ORDER BY name`,
      sql`SELECT * FROM member_leave_history`,
      sql`SELECT * FROM member_awards`,
      sql`SELECT * FROM member_discipline`,
      sql`SELECT * FROM member_career`,
      sql`SELECT * FROM member_education`,
      sql`SELECT * FROM member_family`,
      sql`SELECT * FROM holidays ORDER BY id`,
      sql`SELECT * FROM jobs ORDER BY created_at DESC`,
      sql`SELECT * FROM candidates ORDER BY created_at`,
      sql`SELECT * FROM candidate_history ORDER BY date`,
      sql`SELECT * FROM okrs`,
      sql`SELECT * FROM evals`,
      sql`SELECT * FROM calibration_cycles`,
      sql`SELECT * FROM calibration_overrides`,
      sql`SELECT * FROM oneonones ORDER BY date`
    ]);

    const holidayNames = holidays.map(h => h.name);
    const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));

    const members_out = members.map(m => ({
      id: m.id,
      name: m.name,
      nickname: m.nickname || '',
      team: m.team || '',
      position: m.position || '',
      email: m.email || '',
      personalEmail: m.personal_email || '',
      employeeNo: m.employee_no || '',
      hireDate: m.hire_date,
      groupHireDate: m.group_hire_date,
      hireType: m.hire_type || '',
      birthday: m.birthday,
      phone: m.phone || '',
      address: m.address || '',
      laborContract: m.labor_contract || '',
      wageContract: m.wage_contract || '',
      salaryPayInfo: m.salary_pay_info || '',
      workType: { name: m.work_type_name, fixed: m.work_type_fixed, hours: m.work_type_hours },
      overtimePolicy: m.overtime_policy || '',
      leavePolicy: { basis: m.leave_policy_basis, halfDay: m.leave_policy_half_day, promotion: m.leave_policy_promotion },
      restDays: holidayNames,
      leaveHistory: leaveHistory.filter(r => r.member_id === m.id).map(r => ({ reason: r.reason, period: r.period })),
      awards: awards.filter(r => r.member_id === m.id).map(r => ({ title: r.title, date: r.date })),
      discipline: discipline.filter(r => r.member_id === m.id).map(r => ({ reason: r.reason, date: r.date })),
      career: career.filter(r => r.member_id === m.id).map(r => ({ company: r.company, role: r.role, period: r.period })),
      education: education.filter(r => r.member_id === m.id).map(r => ({ school: r.school, major: r.major, period: r.period })),
      family: family.filter(r => r.member_id === m.id).map(r => ({ name: r.name, relation: r.relation })),
      specialNotes: m.special_notes || '',
      deduction: { basic: m.deduction_basic, healthDependents: m.deduction_health_dependents },
      hrInfo: m.hr_info || '',
      intro: m.intro || '',
      workedHours: m.worked_hours || '',
      leaveLeft: m.leave_left || ''
    }));

    const jobs_out = jobs.map(j => ({
      id: j.id, title: j.title, team: j.team, deadline: j.deadline, status: j.status,
      stages: j.stages, submissionDocs: j.submission_docs, preQuestions: j.pre_questions, extraInfo: j.extra_info
    }));

    const candidates_out = candidates.map(c => ({
      id: c.id, jobId: c.job_id, name: c.name, phone: c.phone, email: c.email, selfIntro: c.self_intro, stage: c.stage,
      history: candidateHistory.filter(h => h.candidate_id === c.id).map(h => ({ date: h.date, stage: h.stage, note: h.note }))
    }));

    const okrs_out = okrs.map(o => ({
      id: o.id, quarter: o.quarter, level: o.level, title: o.title, owner: o.owner,
      parent: o.parent_id, progress: o.progress, unit: o.unit, target: o.target
    }));

    const evals_out = evals.map(e => ({
      id: e.id, quarter: e.quarter, employee: e.employee_id, employeeName: memberNameById[e.employee_id] || '(삭제된 구성원)',
      common: e.common, lead: e.lead, job: e.job, performance: e.performance, custom: e.custom,
      strength: e.strength, improve: e.improve
    }));

    const calibration_out = {};
    for (const c of calibrationCycles) {
      calibration_out[c.quarter] = {
        targets: { S: c.target_s, A: c.target_a, B: c.target_b, C: c.target_c, D: c.target_d },
        overrides: {}
      };
    }
    for (const o of calibrationOverrides) {
      if (calibration_out[o.quarter]) {
        calibration_out[o.quarter].overrides[o.eval_id] = { grade: o.grade, reason: o.reason };
      }
    }

    const oneonones_out = oneonones.map(m => ({
      id: m.id, employee: m.employee_id, employeeName: memberNameById[m.employee_id] || '(삭제된 구성원)',
      date: m.date, note: m.note
    }));

    res.status(200).json({
      members: members_out,
      jobs: jobs_out,
      candidates: candidates_out,
      okrs: okrs_out,
      evals: evals_out,
      calibration: calibration_out,
      oneonones: oneonones_out
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load data' });
  }
}
```

- [ ] **Step 4: `GET /api/all` 확인**

Run: `curl -s http://localhost:3000/api/all | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.members.length, d.jobs.length, d.candidates.length, d.okrs.length, d.evals.length, d.oneonones.length)"`
Expected: `5 2 3 3 4 3`

- [ ] **Step 5: `api/public-jobs.js` 구현**

```js
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const jobs = await sql`SELECT id, title, team, deadline, status FROM jobs WHERE status = '진행중' ORDER BY created_at DESC`;
    res.status(200).json(jobs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
}
```

- [ ] **Step 6: `GET /api/public-jobs` 확인 — 민감정보 미포함 검증**

Run: `curl -s http://localhost:3000/api/public-jobs | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.length, Object.keys(d[0]))"`
Expected: `2 [ 'id', 'title', 'team', 'deadline', 'status' ]` — `rrn`, `email` 등 개인정보 필드가 절대 섞여 있으면 안 됨

- [ ] **Step 7: Commit**

```bash
git add api/all.js api/public-jobs.js
git commit -m "feat: add read APIs for full HR dataset and public job listings"
```

---

## Task 5: 구성원(Members) 쓰기 API

**Files:**
- Create: `api/members/index.js`
- Create: `api/members/[id].js`
- Create: `api/members/[id]/lists.js`

**Interfaces:**
- Consumes: Task 1의 `sql`
- Produces: `POST /api/members` (body: `{name, team?, position?, email?, phone?, hireDate?, groupHireDate?}` → `{id}`), `PATCH /api/members/:id` (body: 부분 필드 — `name, nickname, team, position, email, personalEmail, employeeNo, hireDate, groupHireDate, hireType, birthday, phone, address, laborContract, wageContract, salaryPayInfo, overtimePolicy, hrInfo, intro, specialNotes, workedHours, leaveLeft, workType:{name,fixed,hours}, leavePolicy:{basis,halfDay,promotion}, deduction:{basic,healthDependents}` 중 있는 것만 반영), `POST /api/members/:id/lists` (body: `{list: 'leaveHistory'|'awards'|'discipline'|'career'|'education'|'family', item: {...}}`)

- [ ] **Step 1: `api/members/index.js` (POST 생성) 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const [row] = await sql`
      INSERT INTO members (name, team, position, email, phone, hire_date, group_hire_date, hire_type, work_type_name, work_type_fixed, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
      VALUES (${b.name}, ${b.team || ''}, ${b.position || ''}, ${b.email || ''}, ${b.phone || ''}, ${b.hireDate || new Date().toISOString().slice(0,10)}, ${b.groupHireDate || new Date().toISOString().slice(0,10)}, '정규직', '', true, '0시간', '0일', 0, 0)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create member' });
  }
}
```

- [ ] **Step 2: 생성 확인 (`vercel dev`가 떠 있어야 함)**

Run: `curl -s -X POST http://localhost:3000/api/members -H "Content-Type: application/json" -d '{"name":"테스트구성원","team":"QA팀"}'`
Expected: `{"id":"<uuid>"}` 형태 응답

- [ ] **Step 3: `api/members/[id].js` (PATCH 부분수정) 구현**

```js
import { sql } from '../_lib/db.js';

const FIELD_MAP = {
  name: 'name', nickname: 'nickname', team: 'team', position: 'position',
  email: 'email', personalEmail: 'personal_email', employeeNo: 'employee_no',
  hireDate: 'hire_date', groupHireDate: 'group_hire_date', hireType: 'hire_type',
  birthday: 'birthday', phone: 'phone', address: 'address',
  laborContract: 'labor_contract', wageContract: 'wage_contract', salaryPayInfo: 'salary_pay_info',
  overtimePolicy: 'overtime_policy', hrInfo: 'hr_info', intro: 'intro',
  specialNotes: 'special_notes', workedHours: 'worked_hours', leaveLeft: 'leave_left'
};

export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const sets = [];
  const values = [];
  let i = 1;

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (key in body) { sets.push(`${column} = $${i++}`); values.push(body[key]); }
  }
  if (body.workType) {
    sets.push(`work_type_name = $${i++}`); values.push(body.workType.name || '');
    sets.push(`work_type_fixed = $${i++}`); values.push(!!body.workType.fixed);
    sets.push(`work_type_hours = $${i++}`); values.push(body.workType.hours || '');
  }
  if (body.leavePolicy) {
    sets.push(`leave_policy_basis = $${i++}`); values.push(body.leavePolicy.basis || '');
    sets.push(`leave_policy_half_day = $${i++}`); values.push(body.leavePolicy.halfDay || '');
    sets.push(`leave_policy_promotion = $${i++}`); values.push(body.leavePolicy.promotion || '');
  }
  if (body.deduction) {
    sets.push(`deduction_basic = $${i++}`); values.push(body.deduction.basic ?? 0);
    sets.push(`deduction_health_dependents = $${i++}`); values.push(body.deduction.healthDependents ?? 0);
  }

  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

  sets.push(`updated_at = now()`);
  values.push(id);

  try {
    const rows = await sql(`UPDATE members SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, values);
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.status(200).json({ id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update member' });
  }
}
```

- [ ] **Step 4: 수정 확인**

Step 2에서 받은 `id`를 사용:

Run: `curl -s -X PATCH http://localhost:3000/api/members/<id> -H "Content-Type: application/json" -d '{"position":"시니어","workType":{"name":"기본 근무유형","fixed":true,"hours":"주 40시간"}}'`
Expected: `{"id":"<id>"}` 응답, 이후 `curl -s http://localhost:3000/api/all`로 확인 시 해당 구성원의 `position`이 "시니어"로 바뀌어 있어야 함

- [ ] **Step 5: `api/members/[id]/lists.js` (하위 목록 추가) 구현**

```js
import { sql } from '../../_lib/db.js';

const KNOWN_LISTS = ['leaveHistory', 'awards', 'discipline', 'career', 'education', 'family'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { list, item } = req.body || {};
  if (!KNOWN_LISTS.includes(list)) return res.status(400).json({ error: 'Unknown list: ' + list });

  try {
    if (list === 'leaveHistory') {
      await sql`INSERT INTO member_leave_history (member_id, reason, period) VALUES (${id}, ${item.reason || ''}, ${item.period || ''})`;
    } else if (list === 'awards') {
      await sql`INSERT INTO member_awards (member_id, title, date) VALUES (${id}, ${item.title || ''}, ${item.date || null})`;
    } else if (list === 'discipline') {
      await sql`INSERT INTO member_discipline (member_id, reason, date) VALUES (${id}, ${item.reason || ''}, ${item.date || null})`;
    } else if (list === 'career') {
      await sql`INSERT INTO member_career (member_id, company, role, period) VALUES (${id}, ${item.company || ''}, ${item.role || ''}, ${item.period || ''})`;
    } else if (list === 'education') {
      await sql`INSERT INTO member_education (member_id, school, major, period) VALUES (${id}, ${item.school || ''}, ${item.major || ''}, ${item.period || ''})`;
    } else if (list === 'family') {
      await sql`INSERT INTO member_family (member_id, name, relation) VALUES (${id}, ${item.name || ''}, ${item.relation || ''})`;
      await sql`UPDATE members SET deduction_basic = (SELECT COUNT(*) FROM member_family WHERE member_id = ${id}) + 1 WHERE id = ${id}`;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add list item' });
  }
}
```

- [ ] **Step 6: 하위 목록 추가 확인**

Run: `curl -s -X POST http://localhost:3000/api/members/<id>/lists -H "Content-Type: application/json" -d '{"list":"career","item":{"company":"테스트회사","role":"엔지니어","period":"2020~2022"}}'`
Expected: `{"ok":true}`, 이후 `GET /api/all`에서 해당 구성원의 `career` 배열에 항목이 추가됨

- [ ] **Step 7: 테스트 데이터 정리**

Run: `curl -s -X DELETE ... ` 대신, Neon SQL Editor에서: `DELETE FROM members WHERE name = '테스트구성원';` (ON DELETE CASCADE로 관련 career 행도 함께 삭제됨)

- [ ] **Step 8: Commit**

```bash
git add api/members
git commit -m "feat: add members create/update/list-item APIs"
```

---

## Task 6: 공휴일(Holidays) 쓰기 API

**Files:**
- Create: `api/holidays.js`

**Interfaces:**
- Produces: `PUT /api/holidays` (body: `{names: string[]}`) — 전체 회사 공휴일 목록을 통째로 교체 (목록 자체가 작고 회사 전체 공유값이라 개별 CRUD 대신 통째 교체가 더 단순함)

- [ ] **Step 1: 구현**

```js
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { names } = req.body || {};
  if (!Array.isArray(names)) return res.status(400).json({ error: 'names must be an array' });

  try {
    await sql`DELETE FROM holidays`;
    for (const name of names) {
      await sql`INSERT INTO holidays (name) VALUES (${name})`;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update holidays' });
  }
}
```

- [ ] **Step 2: 확인**

Run: `curl -s -X PUT http://localhost:3000/api/holidays -H "Content-Type: application/json" -d '{"names":["1월 1일","설날","테스트공휴일"]}'`
Expected: `{"ok":true}`, `GET /api/all`의 모든 구성원 `restDays`가 3개짜리 새 목록으로 바뀌어 있어야 함 (공유 테이블이므로 전원 동일하게 반영)

- [ ] **Step 3: 원복 (시드 상태로 되돌림)**

Run: `curl -s -X PUT http://localhost:3000/api/holidays -H "Content-Type: application/json" -d '{"names":["1월 1일","설날","3·1절","어린이날","현충일","광복절","추석","성탄절"]}'`

- [ ] **Step 4: Commit**

```bash
git add api/holidays.js
git commit -m "feat: add shared company holidays API"
```

---

## Task 7: 채용공고(Jobs) 쓰기 API

**Files:**
- Create: `api/jobs/index.js`
- Create: `api/jobs/[id].js`

**Interfaces:**
- Produces: `POST /api/jobs` (body: `{title, team?, deadline?, stages?, submissionDocs?, preQuestions?, extraInfo?}` → `{id}`), `DELETE /api/jobs/:id` (연결된 지원자도 CASCADE로 함께 삭제됨)

- [ ] **Step 1: `api/jobs/index.js` 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const [row] = await sql`
      INSERT INTO jobs (title, team, deadline, status, stages, submission_docs, pre_questions, extra_info)
      VALUES (${b.title}, ${b.team || '-'}, ${b.deadline || null}, '진행중',
        ${JSON.stringify(b.stages || [])}::jsonb,
        ${JSON.stringify(b.submissionDocs || [])}::jsonb,
        ${JSON.stringify(b.preQuestions || [])}::jsonb,
        ${JSON.stringify(b.extraInfo || {})}::jsonb)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create job' });
  }
}
```

- [ ] **Step 2: 생성 확인**

Run: `curl -s -X POST http://localhost:3000/api/jobs -H "Content-Type: application/json" -d '{"title":"테스트공고","team":"QA팀","stages":["접수","처우협의"]}'`
Expected: `{"id":"<uuid>"}`

- [ ] **Step 3: `api/jobs/[id].js` (DELETE) 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await sql`DELETE FROM jobs WHERE id = ${id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete job' });
  }
}
```

- [ ] **Step 4: 삭제 확인**

Run: `curl -s -X DELETE http://localhost:3000/api/jobs/<id>`
Expected: `{"ok":true}`, `GET /api/all`에서 해당 공고가 사라져 있어야 함

- [ ] **Step 5: Commit**

```bash
git add api/jobs
git commit -m "feat: add job posting create/delete APIs"
```

---

## Task 8: 지원자(Candidates) 쓰기 API

**Files:**
- Create: `api/jobs/[id]/candidates.js`
- Create: `api/candidates/[id].js`

**Interfaces:**
- Consumes: Task 7의 `jobs` 테이블
- Produces: `POST /api/jobs/:jobId/candidates` (body: `{name, phone?, email?, selfIntro?}` → `{id}`) — `hr-system.html`의 관리자 등록과 `apply-landing.html`의 공개 지원서 제출이 공유하는 엔드포인트. `PATCH /api/candidates/:id` (body: `{stage}`) — 단계 변경 + 이력 자동 기록.

- [ ] **Step 1: `api/jobs/[id]/candidates.js` 구현**

```js
import { sql } from '../../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: jobId } = req.query;
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const [job] = await sql`SELECT stages FROM jobs WHERE id = ${jobId}`;
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const firstStage = job.stages[0] || '접수';

    const [candidate] = await sql`
      INSERT INTO candidates (job_id, name, phone, email, self_intro, stage)
      VALUES (${jobId}, ${b.name}, ${b.phone || '-'}, ${b.email || null}, ${b.selfIntro || null}, ${firstStage})
      RETURNING id`;

    await sql`INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES (${candidate.id}, current_date, ${firstStage}, '지원서 접수')`;

    res.status(201).json({ id: candidate.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create candidate' });
  }
}
```

- [ ] **Step 2: 생성 확인**

Run: `curl -s -X POST http://localhost:3000/api/jobs/<jobId>/candidates -H "Content-Type: application/json" -d '{"name":"테스트지원자","phone":"010-0000-0000","email":"test@example.com"}'`
Expected: `{"id":"<uuid>"}`, `GET /api/all`에서 해당 지원자의 `history`에 "지원서 접수" 항목이 하나 있어야 함

- [ ] **Step 3: `api/candidates/[id].js` 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: 'stage is required' });

  try {
    const rows = await sql`UPDATE candidates SET stage = ${stage} WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Candidate not found' });
    await sql`INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES (${id}, current_date, ${stage}, ${stage + ' 단계로 변경'})`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update candidate' });
  }
}
```

- [ ] **Step 4: 단계 변경 확인**

Run: `curl -s -X PATCH http://localhost:3000/api/candidates/<id> -H "Content-Type: application/json" -d '{"stage":"처우협의"}'`
Expected: `{"ok":true}`, `GET /api/all`에서 `stage`가 "처우협의"로 바뀌고 `history`에 항목이 2개가 되어 있어야 함

- [ ] **Step 5: 테스트 데이터 정리**

Neon SQL Editor: `DELETE FROM jobs WHERE title = '테스트공고';` (CASCADE로 지원자/이력도 함께 삭제)

- [ ] **Step 6: Commit**

```bash
git add api/jobs api/candidates
git commit -m "feat: add candidate create and stage-change APIs"
```

---

## Task 9: OKR 쓰기 API

**Files:**
- Create: `api/okrs/index.js`
- Create: `api/okrs/[id].js`

**Interfaces:**
- Produces: `POST /api/okrs` (body: `{quarter?, level?, title, owner?, parent?, progress?, unit?, target?}` → `{id}`), `PATCH /api/okrs/:id` (body: `{progress}`)

- [ ] **Step 1: `api/okrs/index.js` 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const [row] = await sql`
      INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target)
      VALUES (${b.quarter || '2026-Q3'}, ${b.level || '개인'}, ${b.title}, ${b.owner || '-'}, ${b.parent || null}, ${b.progress || 0}, ${b.unit || '%'}, ${b.target || 100})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OKR' });
  }
}
```

- [ ] **Step 2: 생성 확인**

Run: `curl -s -X POST http://localhost:3000/api/okrs -H "Content-Type: application/json" -d '{"title":"테스트 목표","level":"개인","quarter":"2026-Q3"}'`
Expected: `{"id":"<uuid>"}`

- [ ] **Step 3: `api/okrs/[id].js` 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { progress } = req.body || {};
  if (progress === undefined) return res.status(400).json({ error: 'progress is required' });

  try {
    const rows = await sql`UPDATE okrs SET progress = ${Number(progress)} WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'OKR not found' });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update OKR' });
  }
}
```

- [ ] **Step 4: 진척률 변경 확인**

Run: `curl -s -X PATCH http://localhost:3000/api/okrs/<id> -H "Content-Type: application/json" -d '{"progress":50}'`
Expected: `{"ok":true}`

- [ ] **Step 5: 테스트 데이터 정리**

Neon SQL Editor: `DELETE FROM okrs WHERE title = '테스트 목표';`

- [ ] **Step 6: Commit**

```bash
git add api/okrs
git commit -m "feat: add OKR create and progress-update APIs"
```

---

## Task 10: 평가(Evals) + 캘리브레이션 쓰기 API

**Files:**
- Create: `api/evals/index.js`
- Create: `api/evals/[id].js`
- Create: `api/calibration/[quarter]/overrides.js`

**Interfaces:**
- Consumes: Task 2의 `members` 테이블 (evals는 이제 이름 문자열이 아니라 `employee_id`로 구성원을 참조)
- Produces: `POST /api/evals` (body: `{quarter?, employeeId, common, lead, job, performance, custom, strength?, improve?}` → `{id}`), `DELETE /api/evals/:id`, `PUT /api/calibration/:quarter/overrides` (body: `{evalId, grade, reason}`)

- [ ] **Step 1: `api/evals/index.js` 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.employeeId) return res.status(400).json({ error: 'employeeId is required' });

  try {
    const [row] = await sql`
      INSERT INTO evals (quarter, employee_id, common, lead, job, performance, custom, strength, improve)
      VALUES (${b.quarter || '2026-Q2'}, ${b.employeeId}, ${b.common}, ${b.lead}, ${b.job}, ${b.performance}, ${b.custom}, ${b.strength || '-'}, ${b.improve || '-'})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create eval' });
  }
}
```

- [ ] **Step 2: 생성 확인**

`GET /api/all`로 확인한 기존 구성원 uuid 하나를 `<memberId>`로 사용:

Run: `curl -s -X POST http://localhost:3000/api/evals -H "Content-Type: application/json" -d '{"quarter":"2026-Q2","employeeId":"<memberId>","common":3,"lead":3,"job":3,"performance":3,"custom":3}'`
Expected: `{"id":"<uuid>"}`

- [ ] **Step 3: `api/evals/[id].js` (DELETE) 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  try {
    await sql`DELETE FROM evals WHERE id = ${id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete eval' });
  }
}
```

- [ ] **Step 4: 삭제 확인**

Run: `curl -s -X DELETE http://localhost:3000/api/evals/<id>`
Expected: `{"ok":true}`

- [ ] **Step 5: `api/calibration/[quarter]/overrides.js` 구현**

```js
import { sql } from '../../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { quarter } = req.query;
  const { evalId, grade, reason } = req.body || {};
  if (!evalId || !grade) return res.status(400).json({ error: 'evalId and grade are required' });

  try {
    await sql`INSERT INTO calibration_cycles (quarter) VALUES (${quarter}) ON CONFLICT (quarter) DO NOTHING`;
    await sql`
      INSERT INTO calibration_overrides (quarter, eval_id, grade, reason)
      VALUES (${quarter}, ${evalId}, ${grade}, ${reason || ''})
      ON CONFLICT (quarter, eval_id) DO UPDATE SET grade = EXCLUDED.grade, reason = EXCLUDED.reason`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update calibration override' });
  }
}
```

(부분 업데이트 로직 — grade만 바꾸거나 reason만 바꾸는 처리 — 는 프론트엔드 쪽에서 현재 값을 채워 항상 완전한 `{grade, reason}` 쌍을 보내는 방식으로 처리한다. Task 14에서 다룬다.)

- [ ] **Step 6: 오버라이드 확인**

기존 시드 평가 하나의 `id`를 `<evalId>`로 사용:

Run: `curl -s -X PUT http://localhost:3000/api/calibration/2026-Q2/overrides -H "Content-Type: application/json" -d '{"evalId":"<evalId>","grade":"S","reason":"테스트 조정"}'`
Expected: `{"ok":true}`, `GET /api/all`의 `calibration["2026-Q2"].overrides["<evalId>"]`가 `{grade:"S", reason:"테스트 조정"}`이어야 함

- [ ] **Step 7: 테스트 데이터 정리**

Neon SQL Editor: `DELETE FROM calibration_overrides WHERE reason = '테스트 조정';`

- [ ] **Step 8: Commit**

```bash
git add api/evals api/calibration
git commit -m "feat: add eval create/delete and calibration override APIs"
```

---

## Task 11: 1:1(OneOnOne) 쓰기 API

**Files:**
- Create: `api/oneonones/index.js`

**Interfaces:**
- Produces: `POST /api/oneonones` (body: `{employeeId, date, note?}` → `{id}`)

- [ ] **Step 1: 구현**

```js
import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.employeeId) return res.status(400).json({ error: 'employeeId is required' });

  try {
    const [row] = await sql`
      INSERT INTO oneonones (employee_id, date, note)
      VALUES (${b.employeeId}, ${b.date}, ${b.note || '-'})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create one-on-one' });
  }
}
```

- [ ] **Step 2: 확인**

Run: `curl -s -X POST http://localhost:3000/api/oneonones -H "Content-Type: application/json" -d '{"employeeId":"<memberId>","date":"2026-07-30","note":"테스트 면담"}'`
Expected: `{"id":"<uuid>"}`

- [ ] **Step 3: 테스트 데이터 정리**

Neon SQL Editor: `DELETE FROM oneonones WHERE note = '테스트 면담';`

- [ ] **Step 4: Commit**

```bash
git add api/oneonones
git commit -m "feat: add one-on-one create API"
```

---

## Task 12: `hr-system.html` — API 클라이언트 & 구성원 섹션 연동

**Files:**
- Modify: `hr-system.html:414-611` (저장소 헬퍼, `seedData()`, 구성원 추가/저장 부분)
- Modify: `hr-system.html:708-814` (구성원 프로필 필드/근무정보/휴가정책/쉬는날/휴직·수상·징계·경력·학력·가족 저장 부분)

**Interfaces:**
- Consumes: Task 4의 `GET /api/all`, Task 5의 members 쓰기 API
- Produces: 전역 `DB` 객체(기존과 동일한 중첩 모양), `refreshDB()` 헬퍼(이후 태스크 13~15가 재사용), `apiGet/apiPost/apiPatch/apiPut/apiDelete` 헬퍼(이후 태스크 13~15가 재사용)

- [ ] **Step 1: 저장소 헬퍼 + `seedData()` 블록 교체**

`hr-system.html`의 414~542행(`/* ---------- Storage helpers ---------- */`부터 `let DB = loadData();`까지)을 아래로 교체:

```js
/* ---------- API client ---------- */
const API = '/api';
async function apiGet(path){ const r = await fetch(API+path); if(!r.ok) throw new Error('GET '+path+' failed'); return r.json(); }
async function apiPost(path, body){ const r = await fetch(API+path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); if(!r.ok) throw new Error('POST '+path+' failed'); return r.json(); }
async function apiPatch(path, body){ const r = await fetch(API+path, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); if(!r.ok) throw new Error('PATCH '+path+' failed'); return r.json(); }
async function apiPut(path, body){ const r = await fetch(API+path, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); if(!r.ok) throw new Error('PUT '+path+' failed'); return r.json(); }
async function apiDelete(path){ const r = await fetch(API+path, {method:'DELETE'}); if(!r.ok) throw new Error('DELETE '+path+' failed'); return r.json(); }

function today(){ return new Date().toISOString().slice(0,10); }

let DB = { members:[], jobs:[], candidates:[], okrs:[], evals:[], calibration:{}, oneonones:[] };
async function refreshDB(){ DB = await apiGet('/all'); }
async function initApp(){
  await refreshDB();
  renderAll();
}
initApp();
```

(기존 `uid()`, `KEY`, `loadData()`, `saveData()`, `seedData()`는 제거한다 — id는 서버가 생성하고, 저장은 항목별 API 호출로 대체된다.)

- [ ] **Step 2: 구성원 추가(`saveMember`) 교체**

`hr-system.html`에서 `function saveMember(){...}` 전체를 아래로 교체:

```js
async function saveMember(){
  const name = document.getElementById('f-mname2').value.trim();
  if(!name) return alert('이름을 입력해주세요');
  await apiPost('/members', {
    name, team:document.getElementById('f-mteam').value||'', position:document.getElementById('f-mposition').value||'',
    email:document.getElementById('f-memail').value||'', phone:document.getElementById('f-mphone').value||''
  });
  await refreshDB(); closeModal(); renderMembers();
}
```

- [ ] **Step 3: 구성원 필드 저장(`saveMemberField`, `saveBasicInfo`) 교체**

```js
async function saveMemberField(field, value){
  await apiPatch('/members/'+currentMemberId, {[field]: value});
  await refreshDB(); closeModal(); renderMemberProfile();
}
```

```js
async function saveBasicInfo(){
  const patch = {
    name: document.getElementById('f-b-name').value,
    nickname: document.getElementById('f-b-nick').value,
    email: document.getElementById('f-b-email').value,
    personalEmail: document.getElementById('f-b-pemail').value,
    employeeNo: document.getElementById('f-b-empno').value,
    hireDate: document.getElementById('f-b-hire').value,
    groupHireDate: document.getElementById('f-b-ghire').value,
    hireType: document.getElementById('f-b-htype').value,
    birthday: document.getElementById('f-b-bday').value,
    phone: document.getElementById('f-b-phone').value,
    address: document.getElementById('f-b-addr').value
  };
  await apiPatch('/members/'+currentMemberId, patch);
  await refreshDB(); closeModal(); renderMemberProfile();
}
```

`openEditHrInfo()`와 `openEditText()` 안의 버튼 `onclick`에서 `; closeModal();` 부분을 제거한다 (closeModal은 이제 `saveMemberField` 안에서 실행됨). 예: `onclick="saveMemberField('hrInfo', document.getElementById('f-val').value); closeModal();"` → `onclick="saveMemberField('hrInfo', document.getElementById('f-val').value)"`.

- [ ] **Step 4: 근무유형/휴가정책 저장 교체**

`openEditWorkType()`의 저장 버튼 onclick을:

```
onclick="saveWorkType({name:document.getElementById('f-w-name').value, fixed:document.getElementById('f-w-fixed').value==='true', hours:document.getElementById('f-w-hours').value})"
```

로 바꾸고, 아래 헬퍼를 추가:

```js
async function saveWorkType(workType){
  await apiPatch('/members/'+currentMemberId, {workType});
  await refreshDB(); closeModal(); renderMemberProfile();
}
```

`openEditLeavePolicy()`의 저장 버튼 onclick을:

```
onclick="saveLeavePolicy({basis:document.getElementById('f-l-basis').value, halfDay:document.getElementById('f-l-half').value, promotion:document.getElementById('f-l-promo').value})"
```

로 바꾸고:

```js
async function saveLeavePolicy(leavePolicy){
  await apiPatch('/members/'+currentMemberId, {leavePolicy});
  await refreshDB(); closeModal(); renderMemberProfile();
}
```

- [ ] **Step 5: 쉬는 날(공휴일) 저장 교체 — 전사 공유값으로 전환**

`openEditRestDays()`를 아래로 교체 (안내 문구를 "전체 구성원 공유" 문구로 변경):

```js
function openEditRestDays(){
  const m = getCurrentMember();
  showModal(`
    <h3>쉬는 날 정보</h3>
    <div class="modal-sub">쉼표(,)로 구분해서 입력하세요. 이 목록은 전체 구성원이 함께 사용해요.</div>
    <div class="field"><textarea id="f-val" style="min-height:100px;">${(m.restDays||[]).join(', ')}</textarea></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveHolidays(document.getElementById('f-val').value)">저장</button></div>
  `);
}
async function saveHolidays(namesText){
  const names = namesText.split(',').map(s=>s.trim()).filter(Boolean);
  await apiPut('/holidays', {names});
  await refreshDB(); closeModal(); renderMemberProfile();
}
```

- [ ] **Step 6: 휴직/수상/징계/경력/학력/가족 추가 교체**

`openListEntryModal()`을 아래로 교체 (async onSave를 기다리도록):

```js
function openListEntryModal(title, fieldDefs, onSave){
  const inputs = fieldDefs.map((f,i)=>`<div class="field"><label>${f}</label><input id="li-${i}"></div>`).join('');
  showModal(`<h3>${title}</h3>${inputs}
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="(async()=>{ await (${onSave.toString()})(); closeModal(); renderMemberProfile(); })()">추가</button></div>`);
}
function openAddLeaveHistory(){ openListEntryModal('휴직 이력 추가', ['사유','기간'], async function(){ await apiPost('/members/'+currentMemberId+'/lists', {list:'leaveHistory', item:{reason:document.getElementById('li-0').value, period:document.getElementById('li-1').value}}); await refreshDB(); }); }
function openAddAward(){ openListEntryModal('수상 추가', ['수상명','일자'], async function(){ await apiPost('/members/'+currentMemberId+'/lists', {list:'awards', item:{title:document.getElementById('li-0').value, date:document.getElementById('li-1').value}}); await refreshDB(); }); }
function openAddDiscipline(){ openListEntryModal('징계 추가', ['사유','일자'], async function(){ await apiPost('/members/'+currentMemberId+'/lists', {list:'discipline', item:{reason:document.getElementById('li-0').value, date:document.getElementById('li-1').value}}); await refreshDB(); }); }
function openAddCareer(){ openListEntryModal('경력 정보 추가', ['회사명','직책','기간'], async function(){ await apiPost('/members/'+currentMemberId+'/lists', {list:'career', item:{company:document.getElementById('li-0').value, role:document.getElementById('li-1').value, period:document.getElementById('li-2').value}}); await refreshDB(); }); }
function openAddEducation(){ openListEntryModal('학력 정보 추가', ['학교명','전공','기간'], async function(){ await apiPost('/members/'+currentMemberId+'/lists', {list:'education', item:{school:document.getElementById('li-0').value, major:document.getElementById('li-1').value, period:document.getElementById('li-2').value}}); await refreshDB(); }); }
function openAddFamily(){ openListEntryModal('가족 정보 추가', ['이름','관계'], async function(){ await apiPost('/members/'+currentMemberId+'/lists', {list:'family', item:{name:document.getElementById('li-0').value, relation:document.getElementById('li-1').value}}); await refreshDB(); }); }
```

- [ ] **Step 7: 수동 확인**

`vercel dev`가 떠 있는 상태에서 브라우저로 `http://localhost:3000/hr-system.html` 접속:
1. 페이지 로드 시 구성원 5명이 그대로 보이는지 확인
2. "구성원 추가하기"로 신규 구성원 등록 → 목록에 즉시 나타나는지 확인
3. 아무 구성원이나 열어서 "기본 정보 변경"으로 전화번호 수정 → 저장 후 브라우저 새로고침(F5)해도 값이 유지되는지 확인 (Neon에 실제로 저장됐다는 뜻)
4. "경력 정보 추가"로 항목 하나 추가 → 새로고침 후에도 남아있는지 확인
5. "쉬는 날 정보"를 수정 → 다른 구성원 프로필을 열어도 같은 목록으로 보이는지 확인 (공유 테이블 확인)

Expected: 위 5가지 모두 통과, 브라우저 개발자도구 Console에 에러 없음

- [ ] **Step 8: Commit**

```bash
git add hr-system.html
git commit -m "feat: wire hr-system.html members section to Neon-backed API"
```

---

## Task 13: `hr-system.html` — 채용(Jobs/Candidates) 섹션 연동

**Files:**
- Modify: `hr-system.html:948-993` (`saveJob`, `saveCandidate`, `changeStage`, `deleteJob`)

**Interfaces:**
- Consumes: Task 7의 jobs API, Task 8의 candidates API, Task 12의 `refreshDB`/`apiPost`/`apiPatch`/`apiDelete`

- [ ] **Step 1: `saveJob()` 교체**

```js
async function saveJob(){
  captureJobStep();
  if(!jobDraft.title){ alert('공고명을 입력해주세요'); jobStep=1; renderJobModal(); return; }
  await apiPost('/jobs', {title:jobDraft.title, team:jobDraft.team||'-', deadline:jobDraft.deadline||null,
    stages:jobDraft.stages, submissionDocs:jobDraft.submissionDocs, preQuestions:jobDraft.preQuestions, extraInfo:jobDraft.extraInfo});
  await refreshDB(); closeModal(); renderJobs();
}
```

- [ ] **Step 2: `saveCandidate()` 교체**

```js
async function saveCandidate(jobId){
  const name = document.getElementById('f-cname').value.trim();
  if(!name) return alert('이름을 입력해주세요');
  await apiPost('/jobs/'+jobId+'/candidates', {name, phone:document.getElementById('f-cphone').value||'-'});
  await refreshDB(); closeModal(); renderCandidates(); renderDashboard();
}
```

- [ ] **Step 3: `changeStage()` 교체**

```js
async function changeStage(candId, newStage){
  await apiPatch('/candidates/'+candId, {stage:newStage});
  await refreshDB(); renderCandidates(); renderDashboard();
}
```

- [ ] **Step 4: `deleteJob()` 교체**

```js
async function deleteJob(id){
  await apiDelete('/jobs/'+id);
  await refreshDB(); renderJobs();
}
```

- [ ] **Step 5: 수동 확인**

브라우저에서:
1. "채용" 탭 → 새 공고 만들기(3단계) → 저장 후 목록에 나타나는지 확인, 새로고침해도 유지되는지 확인
2. 방금 만든 공고에 후보자 등록 → 지원자 목록에 나타나는지 확인
3. 후보자의 단계를 변경 → 히스토리에 기록이 남는지("전형 히스토리" 보기) 확인
4. 공고 삭제 → 목록에서 사라지고, 새로고침해도 다시 나타나지 않는지 확인

Expected: 4가지 모두 통과

- [ ] **Step 6: Commit**

```bash
git add hr-system.html
git commit -m "feat: wire hr-system.html recruiting section to Neon-backed API"
```

---

## Task 14: `hr-system.html` — OKR/평가/캘리브레이션 섹션 연동

**Files:**
- Modify: `hr-system.html:1023-1172` (`saveOkr`, `updateOkrProgress`, `openEvalModal`, `saveEval`, `renderEval`, `deleteEval`, `renderCalibration`, `setOverride`)

**Interfaces:**
- Consumes: Task 9의 OKR API, Task 10의 evals/calibration API, Task 12의 API 헬퍼

- [ ] **Step 1: `saveOkr()`, `updateOkrProgress()` 교체**

```js
async function saveOkr(){
  const title = document.getElementById('f-otitle').value.trim();
  if(!title) return alert('목표 제목을 입력해주세요');
  await apiPost('/okrs', {quarter:document.getElementById('f-oquarter').value||'2026-Q3', level:document.getElementById('f-olevel').value, title,
    owner:document.getElementById('f-oowner').value||'-', parent:document.getElementById('f-oparent').value||null,
    progress:Number(document.getElementById('f-oprogress').value)||0, unit:document.getElementById('f-ounit').value||'%',
    target:Number(document.getElementById('f-otarget').value)||100});
  await refreshDB(); closeModal(); renderOkr();
}
async function updateOkrProgress(id, val){
  await apiPatch('/okrs/'+id, {progress:Number(val)});
  await refreshDB(); renderOkr();
}
```

- [ ] **Step 2: `openEvalModal()` — 이름 입력을 구성원 선택으로 변경**

`<div class="field"><label>구성원</label><input id="f-ename" placeholder="이름"></div>` 부분을:

```html
<div class="field"><label>구성원</label><select id="f-ename">${DB.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select></div>
```

로 교체.

- [ ] **Step 3: `saveEval()` 교체**

```js
async function saveEval(){
  const employeeId = document.getElementById('f-ename').value;
  if(!employeeId) return alert('구성원을 선택해주세요');
  await apiPost('/evals', {quarter:document.getElementById('f-equarter').value||'2026-Q2', employeeId,
    common:Number(document.getElementById('f-common').value), lead:Number(document.getElementById('f-lead').value), job:Number(document.getElementById('f-job').value),
    performance:Number(document.getElementById('f-eperf').value), custom:Number(document.getElementById('f-ecustom').value),
    strength:document.getElementById('f-estrength').value||'-', improve:document.getElementById('f-eimprove').value||'-'});
  await refreshDB(); closeModal(); renderEval();
}
```

- [ ] **Step 4: `renderEval()` 내 `e.employee`/`p.employee` 표시를 `employeeName`으로 변경**

`renderEval()` 안에서 사람 이름을 화면에 표시하는 세 곳을 수정한다:
- 9-그리드 칩: `div.innerHTML = ...${people.map(p=>\`<span class="chip">${p.employee}</span>\`)...}` → `p.employeeName`
- 평가 테이블 첫 컬럼: `<td>${e.employee}</td>` → `<td>${e.employeeName}</td>`
- AI 리포트 카드 제목: `<b>${e.employee} · ${grade}등급</b>` → `<b>${e.employeeName} · ${grade}등급</b>`

(`gradeFor`, `competency`, `bucket`, `quarterOptionsHtml`, `deleteEval`는 변경 없음 — `deleteEval`만 API 호출로 교체)

- [ ] **Step 5: `deleteEval()` 교체**

```js
async function deleteEval(id){ await apiDelete('/evals/'+id); await refreshDB(); renderEval(); }
```

- [ ] **Step 6: `setOverride()` 교체 — 항상 완전한 {grade, reason}을 서버로 전송**

```js
async function setOverride(quarter, evalId, grade, reason){
  const cal = DB.calibration[quarter] || {overrides:{}};
  const prev = cal.overrides[evalId] || {};
  const e = DB.evals.find(x=>x.id===evalId);
  const computed = gradeFor(e.performance, competency(e));
  const finalGrade = grade!==undefined ? grade : (prev.grade || computed);
  const finalReason = reason!==undefined ? reason : (prev.reason || '');
  await apiPut('/calibration/'+quarter+'/overrides', {evalId, grade:finalGrade, reason:finalReason});
  await refreshDB(); renderCalibration();
}
```

- [ ] **Step 7: 수동 확인**

브라우저에서:
1. OKR 탭 → 새 목표 추가 → 목록에 나타나고 새로고침해도 유지되는지 확인
2. 진척률 슬라이더/입력을 바꿔 저장 → 유지되는지 확인
3. 평가 탭 → "평가 만들기"에서 구성원을 드롭다운으로 선택해 평가 등록 → 9-그리드와 표에 이름이 정상 표시되는지 확인
4. 캘리브레이션 탭 → 등급 조정(select) 변경 → 새로고침 후에도 유지되는지 확인

Expected: 4가지 모두 통과

- [ ] **Step 8: Commit**

```bash
git add hr-system.html
git commit -m "feat: wire hr-system.html OKR/eval/calibration sections to Neon-backed API"
```

---

## Task 15: `hr-system.html` — 1:1 섹션 연동 & 가져오기/초기화 비활성화

**Files:**
- Modify: `hr-system.html:1177-1202` (`openOneOnOneModal`, `saveOneOnOne`, `renderOneOnOne`, `selectEmployee`)
- Modify: `hr-system.html:1277-1301` (`exportData`, `importData`, `resetData`)

**Interfaces:**
- Consumes: Task 11의 oneonones API, Task 12의 API 헬퍼

- [ ] **Step 1: `openOneOnOneModal()` — 이름 입력을 구성원 선택으로 변경**

```js
function openOneOnOneModal(){
  showModal(`
    <h3>원온원 보내기</h3>
    <div class="form-row">
      <div class="field"><label>구성원</label><select id="f-mname">${DB.members.map(m=>`<option value="${m.id}">${m.name}</option>`).join('')}</select></div>
      <div class="field"><label>날짜</label><input id="f-mdate" type="date" value="${today()}"></div>
    </div>
    <div class="field"><label>내용</label><textarea id="f-mnote" placeholder="면담 내용을 기록하세요"></textarea></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveOneOnOne()">저장</button></div>
  `);
}
```

- [ ] **Step 2: `saveOneOnOne()` 교체**

```js
async function saveOneOnOne(){
  const employeeId = document.getElementById('f-mname').value;
  if(!employeeId) return alert('구성원을 선택해주세요');
  await apiPost('/oneonones', {employeeId, date:document.getElementById('f-mdate').value||today(), note:document.getElementById('f-mnote').value||'-'});
  await refreshDB(); closeModal(); currentEmployee = employeeId; renderOneOnOne();
}
```

- [ ] **Step 3: `renderOneOnOne()`, `selectEmployee()` 교체 — id 기반으로 전환**

```js
function renderOneOnOne(){
  const peopleIds = [...new Set(DB.oneonones.map(m=>m.employee))];
  if(!currentEmployee && peopleIds.length) currentEmployee = peopleIds[0];
  const nameOf = id => (DB.oneonones.find(m=>m.employee===id)||{}).employeeName || '';
  document.getElementById('oneonone-people').innerHTML = peopleIds.map(id=>`<button class="btn sm ${id===currentEmployee?'primary':''}" onclick="selectEmployee('${id}')">${nameOf(id)}</button>`).join('') || '<span class="empty">기록된 구성원이 없어요</span>';
  const list = DB.oneonones.filter(m=>m.employee===currentEmployee).sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('oneonone-title').textContent = currentEmployee ? nameOf(currentEmployee)+' 님 히스토리' : '히스토리';
  document.getElementById('oneonone-timeline').innerHTML = list.map(m=>`<div class="tl-item"><div class="tl-date">${m.date}</div><div class="tl-body">${m.note}</div></div>`).join('') || '<div class="empty">기록이 없어요</div>';
}
function selectEmployee(id){ currentEmployee = id; renderOneOnOne(); }
```

- [ ] **Step 4: `exportData`/`importData`/`resetData` 교체**

```js
function exportData(){
  const blob = new Blob([JSON.stringify(DB, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hr-data-backup.json'; a.click();
}
function importData(evt){ alert('실제 데이터베이스로 전환된 이후에는 가져오기가 지원되지 않아요. 각 화면에서 개별적으로 추가해주세요.'); evt.target.value=''; }
function resetData(){ alert('실제 데이터베이스로 전환된 이후에는 전체 초기화가 지원되지 않아요. 필요하면 Neon 콘솔에서 직접 데이터를 관리해주세요.'); }
```

- [ ] **Step 5: 수동 확인**

브라우저에서:
1. 1:1 탭 → "원온원 보내기"에서 구성원을 드롭다운으로 선택 후 저장 → 좌측 인물 목록과 타임라인에 정상 표시되는지 확인, 새로고침해도 유지되는지 확인
2. 데이터 관리 탭 → "전체 데이터 내보내기" 클릭 → JSON 파일이 다운로드되는지 확인
3. "가져오기"/"전체 초기화" 버튼 클릭 → 안내 alert만 뜨고 실제로 데이터가 지워지지 않는지 확인

Expected: 3가지 모두 통과

- [ ] **Step 6: Commit**

```bash
git add hr-system.html
git commit -m "feat: wire hr-system.html one-on-one section to Neon-backed API, retire local import/reset"
```

---

## Task 16: `apply-landing.html` — 실제 채용공고 목록 & 지원서 제출 연동

**Files:**
- Modify: `apply-landing.html` (전체 — 정적 목업에 실제 JS 추가)

**Interfaces:**
- Consumes: Task 4의 `GET /api/public-jobs` (공개, 민감정보 없음), Task 8의 `POST /api/jobs/:id/candidates`

- [ ] **Step 1: 공고 목록 영역을 동적 컨테이너로 교체**

기존 하드코딩된 4개 `<a class="job-card" href="job-detail.html">...</a>` 블록 전체를 아래로 교체:

```html
<div class="job-list" id="job-list"></div>
```

- [ ] **Step 2: 지원서 폼 입력에 id 부여, 제출 버튼을 실제 버튼으로 변경**

```html
<div class="form-grid">
  <div class="field"><label>이름 <span class="req">*</span></label><input id="f-name" type="text" placeholder="홍길동"></div>
  <div class="field"><label>연락처 <span class="req">*</span></label><input id="f-phone" type="tel" placeholder="010-0000-0000"></div>
  <div class="field"><label>이메일 <span class="req">*</span></label><input id="f-email" type="email" placeholder="example@email.com"></div>
  <div class="field">
    <label>지원 포지션 <span class="req">*</span></label>
    <select id="f-job"></select>
  </div>
</div>

<div class="form-grid full" style="margin-top:16px;">
  <div class="field">
    <label>이력서 / 포트폴리오 첨부 <span class="req">*</span></label>
    <div class="upload-box">📎 파일 첨부는 다음 단계에서 지원될 예정이에요</div>
  </div>
  <div class="field">
    <label>자기소개 <span class="req">*</span></label>
    <textarea id="f-intro" placeholder="본인을 간단히 소개해주세요 (지원 동기, 강점 등)"></textarea>
  </div>
</div>

<div class="agree">
  <input id="f-agree" type="checkbox"> 개인정보 수집 및 이용에 동의합니다 (채용 전형 진행 목적, 보유기간 전형 종료 후 1년)
</div>
<button type="button" class="submit-btn" id="f-submit" onclick="submitApplication()">지원서 제출하기 →</button>
```

(이력서 파일 첨부는 스펙에서 이번 범위 제외로 합의됨 — 업로드 박스는 안내 문구만 두고 실제 업로드는 구현하지 않는다.)

- [ ] **Step 3: 동적 로딩 + 제출 스크립트 추가**

`</body>` 바로 앞에 추가:

```html
<script>
async function loadJobs(){
  const res = await fetch('/api/public-jobs');
  const jobs = await res.json();
  const list = document.getElementById('job-list');
  list.innerHTML = jobs.map(j => `
    <a class="job-card" href="job-detail.html">
      <div class="l">
        <b>${j.title}</b>
        <div class="meta"><span>${j.team||'-'}</span></div>
      </div>
      <div class="r"><span class="apply-mini">공고 보기</span></div>
    </a>
  `).join('') || '<div class="empty">진행중인 채용공고가 없어요</div>';

  const select = document.getElementById('f-job');
  select.innerHTML = jobs.map(j => `<option value="${j.id}">${j.title}</option>`).join('');
}

async function submitApplication(){
  const jobId = document.getElementById('f-job').value;
  const name = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const selfIntro = document.getElementById('f-intro').value.trim();
  const agree = document.getElementById('f-agree').checked;

  if(!jobId){ alert('지원할 포지션을 선택해주세요'); return; }
  if(!name || !phone || !email){ alert('이름, 연락처, 이메일을 입력해주세요'); return; }
  if(!agree){ alert('개인정보 수집 및 이용에 동의해주세요'); return; }

  const res = await fetch(`/api/jobs/${jobId}/candidates`, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({name, phone, email, selfIntro})
  });
  if(!res.ok){ alert('제출 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.'); return; }

  alert('지원서가 제출됐어요. 담당자 검토 후 연락드릴게요!');
  document.getElementById('f-name').value = '';
  document.getElementById('f-phone').value = '';
  document.getElementById('f-email').value = '';
  document.getElementById('f-intro').value = '';
  document.getElementById('f-agree').checked = false;
}

loadJobs();
</script>
```

- [ ] **Step 4: 수동 확인**

`vercel dev`가 떠 있는 상태에서 브라우저로 `http://localhost:3000/apply-landing.html` 접속:
1. 공고 목록에 Neon에 있는 실제 채용공고(2건)가 보이는지 확인
2. "지원 포지션" 드롭다운에도 같은 2건이 보이는지 확인
3. 이름/연락처/이메일/자기소개 입력 후 동의 체크, 제출 → 완료 알림이 뜨는지 확인
4. `curl -s http://localhost:3000/api/all | node -e "..."` 로 방금 제출한 지원자가 해당 공고의 `candidates` 목록에 추가됐는지 확인
5. 브라우저 개발자도구 Network 탭에서 `/api/all`이 이 페이지에서 호출되지 않는지 확인 (공개 페이지는 `/api/public-jobs`만 써야 함 — 민감정보 유출 방지)

Expected: 5가지 모두 통과

- [ ] **Step 5: Commit**

```bash
git add apply-landing.html
git commit -m "feat: wire apply-landing.html to public job listing and candidate submission APIs"
```

---

## Task 17: 엔드투엔드 확인 & Vercel 배포 준비

**Files:**
- 없음 (검증 전용 태스크)

**Interfaces:**
- Consumes: Task 1~16 전체

- [ ] **Step 1: 로컬 전체 시나리오 재확인**

`vercel dev` 실행 상태에서 `hr-system.html`을 열고, 아래를 순서대로 한 번에 수행:
1. 새 구성원 등록 → 2. 그 구성원 평가 등록 → 3. 그 구성원과 1:1 기록 등록 → 4. 새 채용공고 등록 → 5. `apply-landing.html`에서 그 공고에 실제로 지원서 제출 → 6. `hr-system.html`로 돌아와 후보자 목록에 방금 지원한 사람이 보이는지 확인 → 7. 후보자 단계 변경

Expected: 7단계 모두 새로고침 후에도 데이터가 유지됨 (Neon에 실제로 저장되고 있다는 증거)

- [ ] **Step 2: `package.json` 스크립트 정리 확인**

Run: `cat package.json`
Expected: `@neondatabase/serverless`, `jsdom` 의존성과 `"type": "module"`이 들어있는지 확인

- [ ] **Step 3: Vercel 배포 안내**

다음은 사용자가 직접 수행 (에이전트가 대신 배포하지 않음):
1. `vercel` CLI로 프로젝트를 Vercel에 연결 (`npx vercel link`)
2. Vercel 대시보드 → 프로젝트 → Storage → Neon 통합 연결 (이미 쓰던 Neon 프로젝트 선택) → `DATABASE_URL`이 자동으로 환경변수에 추가됨
3. `npx vercel --prod`로 배포

- [ ] **Step 4: 최종 커밋 확인**

Run: `git log --oneline`
Expected: Task 1~16의 커밋들이 순서대로 남아있음
