# 인재검색 Phase 1C (새 인재검색 입력 화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "인재검색 → 대시보드"에 "+ 새 인재검색" 버튼을 추가해서, 실제로 `talent_search_projects`에 저장되는 검색 프로젝트 생성 폼을 만든다. 직무 템플릿 저장/불러오기, 그리고 AI 없이 규칙으로만 흉내내는 "추가질문 시뮬레이션"까지 포함한다.

**Architecture:** `talent_search_projects`(Phase 1A에 이미 대부분 있음)에 키워드 5종/추가질문답변 컬럼을 보강하고, 새 테이블 `talent_search_job_templates`를 추가한다. 검증 로직은 DB 의존성이 없는 `handlers/_lib/talentSearchProjectValidate.js`에 순수 함수로 분리해서 `node --test`로 테스트하고, 두 개의 얇은 핸들러(`talent-search-projects`, `talent-search-job-templates`)가 이 검증을 호출한다. 프론트는 기존 `jobDraft`(공고 생성) 패턴처럼 전역 draft 객체 + 순수 문자열 렌더링으로 폼을 만들고, 제출 시 클라이언트에서만 규칙 기반 추가질문을 시뮬레이션한다.

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`, 순수 SQL, `node --test`.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-25-talent-search-phase1c-design.md` — 정확한 필드 목록·API 모양·화면 흐름은 이 문서에서 그대로 가져온다.
- 새 엔드포인트 2개(`/talent-search-projects`, `/talent-search-job-templates`) 모두 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에도 반드시 등록한다.
- 검증 로직(`validateTalentSearchProjectInput`, `validateJobTemplateInput`)은 `handlers/_lib/db.js`를 import하지 않는 별도 파일에 둔다 — 1B-3에서 이미 겪은 문제(검증 함수가 핸들러 파일에 같이 있으면 그 파일이 `db.js`를 import해서 `DATABASE_URL` 없이는 단위테스트조차 못 돈다)를 처음부터 피한다.
- 이 프로젝트는 순수 계산/검증 로직만 `node --test`로 단위테스트하고, DB/HTTP/UI 통합 작업은 로컬 dev 서버 브라우저 수동 검증으로 확인한다.
- 검색 프로젝트는 항상 `status='draft'`로 생성된다. 검색기준 확인·승인(1D), 검색 진행(1E), 대시보드 카드 목록 연동, 프로젝트 목록 조회(GET)는 이번 범위 밖 — 만들지 않는다.
- 추가질문 시뮬레이션은 서버 로직 없이 클라이언트에서만 판단한다(진짜 AI 아님).
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖.

---

### Task 1: 마이그레이션 — 키워드 컬럼 보강 + 직무 템플릿 테이블

**Files:**
- Create: `sql/017_talent_search_project_input.sql`

**Interfaces:**
- Produces: `talent_search_projects.keywords`(jsonb), `talent_search_projects.clarification_notes`(jsonb), 새 테이블 `talent_search_job_templates(id, name, criteria, created_by, created_at)`. Task 3/4이 이 컬럼/테이블에 INSERT/SELECT한다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- sql/017_talent_search_project_input.sql
--
-- 2026-08-25: 인재검색 자동화 Phase 1C(새 인재검색 입력 화면). Phase 1A가
-- 만든 talent_search_projects 스키마에는 원본 명세 3.1절의 "기본 화면
-- 입력" 중 키워드 5종(포함/OR/정확일치/제외/우대)이 빠져 있었다 --
-- 이번에 보강한다. clarification_notes는 이번에 새로 추가하는 "추가질문
-- 최대 3개 시뮬레이션"(AI 없이 규칙 기반) 답변을 담는다.
--
-- work_conditions(Phase 1A에 이미 있음, jsonb)는 그대로 재사용한다 --
-- "근무지역 외 필수 근무조건"뿐 아니라 3.1절의 선택적 상세조건(입사가능
-- 시점/연봉/재택여부/필수자격/피해야 할 경력유형)까지 자유 키로 담는
-- 용도로 확장한다. 컬럼 자체는 안 바뀐다.
ALTER TABLE talent_search_projects
  ADD COLUMN IF NOT EXISTS keywords jsonb NOT NULL DEFAULT '{"include":[],"or":[],"exact":[],"exclude":[],"preferred":[]}',
  ADD COLUMN IF NOT EXISTS clarification_notes jsonb NOT NULL DEFAULT '[]';

-- 직무 템플릿. criteria는 검색 프로젝트 입력 폼의 조건 필드 전체를 그대로
-- 담는 스냅샷이다(검색 프로젝트명은 제외 -- 프로젝트마다 새로 짓는
-- 이름이라 템플릿과 무관). 템플릿을 나중에 고쳐도 과거에 이미 만든
-- 검색 프로젝트에는 영향이 없다(스냅샷이라 자연히 만족됨).
CREATE TABLE IF NOT EXISTS talent_search_job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  criteria jsonb NOT NULL,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: 로컬 development 브랜치에 적용**

Run: `node scripts/run-sql.js sql/017_talent_search_project_input.sql`
Expected: `OK: executed sql/017_talent_search_project_input.sql`

- [ ] **Step 3: 스키마 확인**

Run:
```bash
node -e "
import('./handlers/_lib/db.js').then(async ({sql}) => {
  const cols = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='talent_search_projects' AND column_name IN ('keywords','clarification_notes')\`;
  console.log('projects cols:', cols.map(c=>c.column_name));
  const tmpl = await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='talent_search_job_templates' ORDER BY ordinal_position\`;
  console.log('templates cols:', tmpl.map(c=>c.column_name));
});
"
```
Expected: `projects cols: [ 'keywords', 'clarification_notes' ]`, `templates cols: [ 'id', 'name', 'criteria', 'created_by', 'created_at' ]`

- [ ] **Step 4: Commit**

```bash
git add sql/017_talent_search_project_input.sql
git commit -m "feat: 인재검색 프로젝트 키워드 컬럼 보강 + 직무 템플릿 테이블 추가"
```

---

### Task 2: 순수 검증 로직 `handlers/_lib/talentSearchProjectValidate.js`

**Files:**
- Create: `handlers/_lib/talentSearchProjectValidate.js`
- Test: `handlers/_lib/talentSearchProjectValidate.test.js`

**Interfaces:**
- Produces: `export const TALENT_SEARCH_PLATFORMS` (문자열 배열, 4개), `export function validateTalentSearchProjectInput(body)` (통과 시 `null`, 실패 시 한국어 에러 문자열), `export function validateJobTemplateInput(body)`(같은 규약). Task 3이 첫 두 개를, Task 4가 마지막 것을 import한다. 이 파일은 `handlers/_lib/db.js`를 import하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// handlers/_lib/talentSearchProjectValidate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTalentSearchProjectInput, validateJobTemplateInput, TALENT_SEARCH_PLATFORMS } from './talentSearchProjectValidate.js';

const VALID = {
  title: '2026년 8월 리빙MD 채용',
  roleTitle: '리빙상품 기획MD',
  employmentType: '정규직',
  headcount: 1,
  targetRecommendCount: 30,
  platforms: ['사람인', '원티드'],
  keywords: { include: ['MD'], or: [], exact: [], exclude: [], preferred: [] }
};

test('validateTalentSearchProjectInput: 올바른 값이면 null', () => {
  assert.equal(validateTalentSearchProjectInput(VALID), null);
});

test('validateTalentSearchProjectInput: title이 없으면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, title: '' }));
});

test('validateTalentSearchProjectInput: headcount가 0이면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, headcount: 0 }));
});

test('validateTalentSearchProjectInput: targetRecommendCount가 소수면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, targetRecommendCount: 1.5 }));
});

test('validateTalentSearchProjectInput: platforms가 빈 배열이면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, platforms: [] }));
});

test('validateTalentSearchProjectInput: 허용 안 된 플랫폼이면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, platforms: ['링크드인'] }));
});

test('validateTalentSearchProjectInput: keywords 항목이 배열이 아니면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, keywords: { ...VALID.keywords, include: 'MD' } }));
});

test('validateTalentSearchProjectInput: keywords를 아예 안 보내도 통과 (선택)', () => {
  const { keywords, ...rest } = VALID;
  assert.equal(validateTalentSearchProjectInput(rest), null);
});

test('validateTalentSearchProjectInput: clarificationNotes 형식이 틀리면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, clarificationNotes: [{ question: '질문' }] }));
});

test('TALENT_SEARCH_PLATFORMS: 4개 플랫폼', () => {
  assert.deepEqual(TALENT_SEARCH_PLATFORMS, ['사람인', '잡코리아', '리멤버', '원티드']);
});

test('validateJobTemplateInput: 올바른 값이면 null', () => {
  assert.equal(validateJobTemplateInput({ name: '리빙MD 템플릿', criteria: { roleTitle: '리빙MD' } }), null);
});

test('validateJobTemplateInput: name이 없으면 에러', () => {
  assert.ok(validateJobTemplateInput({ name: '', criteria: {} }));
});

test('validateJobTemplateInput: criteria가 배열이면 에러', () => {
  assert.ok(validateJobTemplateInput({ name: '템플릿', criteria: [] }));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test handlers/_lib/talentSearchProjectValidate.test.js`
Expected: FAIL — 파일 자체가 없어서 import 에러

- [ ] **Step 3: 검증 로직 작성**

```js
// handlers/_lib/talentSearchProjectValidate.js
/**
 * handlers/_lib/talentSearchProjectValidate.js
 *
 * 인재검색 프로젝트/직무 템플릿 생성 입력값의 순수 검증 로직. DB나 다른
 * 프로젝트 내부 모듈을 import하지 않는다 -- Phase 1B-3에서 검증 로직이
 * db.js를 import하는 핸들러 파일과 같이 있어서 DATABASE_URL 없이는
 * 단위테스트조차 못 돌던 문제를 겪었고, 그때 만든 해결 패턴(순수 검증
 * 전용 파일 분리)을 이번엔 처음부터 따른다.
 */

export const TALENT_SEARCH_PLATFORMS = ['사람인', '잡코리아', '리멤버', '원티드'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(s => typeof s === 'string');
}

export function validateTalentSearchProjectInput(body) {
  if (!body || typeof body !== 'object') return '입력값이 올바르지 않아요';
  if (!isNonEmptyString(body.title)) return '검색 프로젝트명을 입력해주세요';
  if (!isNonEmptyString(body.roleTitle)) return '채용 직무/포지션명을 입력해주세요';
  if (!isNonEmptyString(body.employmentType)) return '고용형태를 입력해주세요';
  if (!isPositiveInt(body.headcount)) return '채용인원은 1명 이상의 정수여야 해요';
  if (!isPositiveInt(body.targetRecommendCount)) return '총 적합 추천 목표 인원은 1명 이상의 정수여야 해요';
  if (!Array.isArray(body.platforms) || body.platforms.length === 0) return '검색할 플랫폼을 1개 이상 선택해주세요';
  if (body.platforms.some(p => !TALENT_SEARCH_PLATFORMS.includes(p))) return '지원하지 않는 플랫폼이 포함돼 있어요';

  if (body.keywords !== undefined) {
    if (!body.keywords || typeof body.keywords !== 'object') return '키워드 형식이 올바르지 않아요';
    for (const field of ['include', 'or', 'exact', 'exclude', 'preferred']) {
      if (body.keywords[field] !== undefined && !isStringArray(body.keywords[field])) {
        return '키워드 형식이 올바르지 않아요';
      }
    }
  }

  if (body.clarificationNotes !== undefined) {
    if (!Array.isArray(body.clarificationNotes)) return '추가질문 답변 형식이 올바르지 않아요';
    const ok = body.clarificationNotes.every(
      n => n && typeof n === 'object' && typeof n.question === 'string' && typeof n.answer === 'string'
    );
    if (!ok) return '추가질문 답변 형식이 올바르지 않아요';
  }

  return null;
}

export function validateJobTemplateInput(body) {
  if (!body || typeof body !== 'object') return '입력값이 올바르지 않아요';
  if (!isNonEmptyString(body.name)) return '템플릿 이름을 입력해주세요';
  if (!body.criteria || typeof body.criteria !== 'object' || Array.isArray(body.criteria)) return '템플릿 내용이 올바르지 않아요';
  return null;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test handlers/_lib/talentSearchProjectValidate.test.js`
Expected: 13개 테스트 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add handlers/_lib/talentSearchProjectValidate.js handlers/_lib/talentSearchProjectValidate.test.js
git commit -m "feat: 인재검색 프로젝트/직무템플릿 입력 검증 로직 추가"
```

---

### Task 3: `POST /api/talent-search-projects`

**Files:**
- Create: `handlers/talent-search-projects/index.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 2의 `validateTalentSearchProjectInput`, 기존 `requireTalentSearchAccess`(`handlers/_lib/accountAuth.js`), 기존 `sql`(`handlers/_lib/db.js`)
- Produces: `POST /api/talent-search-projects` `{ title, roleTitle, seniorityLevel?, experienceMinYears?, experienceMaxYears?, employmentType, headcount, location?, workConditions?, naturalLanguageBrief?, keywords?, targetRecommendCount, platforms, clarificationNotes? }` → `201 { id }`. Task 5(화면)가 이 엔드포인트를 호출한다.

- [ ] **Step 1: 핸들러 작성**

```js
// handlers/talent-search-projects/index.js
/**
 * handlers/talent-search-projects/index.js
 *
 * POST { title, roleTitle, seniorityLevel?, experienceMinYears?, experienceMaxYears?,
 *        employmentType, headcount, location?, workConditions?, naturalLanguageBrief?,
 *        keywords?: {include,or,exact,exclude,preferred}, targetRecommendCount,
 *        platforms: string[], clarificationNotes?: [{question,answer}] }
 *   -> 201 { id }
 *
 * Phase 1C: 검색 프로젝트를 실제로 만드는 첫 엔드포인트. status는 항상
 * 'draft'로 시작한다 -- 검색기준 확인·승인(1D)과 검색 진행(1E)은 아직
 * 없다. 목록 조회(GET)도 이번 범위 밖이다 -- 만든 프로젝트를 대시보드
 * 카드에 연동하는 건 다음 슬라이스에서 다룬다
 * (docs/superpowers/specs/2026-08-25-talent-search-phase1c-design.md 참고).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { validateTalentSearchProjectInput } from '../_lib/talentSearchProjectValidate.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const body = req.body || {};
  const validationError = validateTalentSearchProjectInput(body);
  if (validationError) return res.status(400).json({ error: validationError });

  const keywords = {
    include: body.keywords?.include || [],
    or: body.keywords?.or || [],
    exact: body.keywords?.exact || [],
    exclude: body.keywords?.exclude || [],
    preferred: body.keywords?.preferred || []
  };

  try {
    const [row] = await sql`
      INSERT INTO talent_search_projects (
        title, role_title, seniority_level, experience_min_years, experience_max_years,
        employment_type, headcount, location, work_conditions, natural_language_brief,
        keywords, clarification_notes, target_recommend_count, platforms, created_by
      ) VALUES (
        ${body.title.trim()}, ${body.roleTitle.trim()}, ${body.seniorityLevel || null},
        ${body.experienceMinYears ?? null}, ${body.experienceMaxYears ?? null},
        ${body.employmentType.trim()}, ${body.headcount}, ${body.location || null},
        ${JSON.stringify(body.workConditions || {})}::jsonb, ${body.naturalLanguageBrief || null},
        ${JSON.stringify(keywords)}::jsonb, ${JSON.stringify(body.clarificationNotes || [])}::jsonb,
        ${body.targetRecommendCount}, ${JSON.stringify(body.platforms)}::jsonb, ${account.id}
      ) RETURNING id`;
    return res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '검색 프로젝트를 만들지 못했어요' });
  }
}
```

- [ ] **Step 2: 라우트 등록**

`api/[...path].js`에 import 추가 (`talentSearchPolicyVersionRestore` import 줄 다음):

```js
import talentSearchProjectsIndex from '../handlers/talent-search-projects/index.js';
```

`ROUTES` 배열에 항목 추가 (`talent-search-policy/versions/:id/restore` 항목 다음):

```js
  { pattern: ['talent-search-projects'], handler: talentSearchProjectsIndex },
```

- [ ] **Step 3: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), ADMIN 테스트 계정(`preview-test@selfdiylab.invalid`/`Preview1234`)으로 로그인해서 쿠키 저장(`curl -c cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"preview-test@selfdiylab.invalid","password":"Preview1234"}'` 후 이어서):

```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/talent-search-projects -H "Content-Type: application/json" -d '{"title":"수동확인용 테스트 프로젝트","roleTitle":"리빙상품 기획MD","employmentType":"정규직","headcount":1,"targetRecommendCount":30,"platforms":["사람인","원티드"],"keywords":{"include":["MD"],"exclude":["단순보조"]}}'
```
Expected: `201 {"id":"<uuid>"}`

Run: 필수값(`title`) 없이 같은 요청 → `400 {"error":"검색 프로젝트명을 입력해주세요"}` 확인
Run: `platforms`를 `["링크드인"]`으로 → `400 {"error":"지원하지 않는 플랫폼이 포함돼 있어요"}` 확인

- [ ] **Step 4: Commit**

```bash
git add "handlers/talent-search-projects/index.js" "api/[...path].js"
git commit -m "feat: POST /api/talent-search-projects 엔드포인트 추가"
```

---

### Task 4: `talent-search-job-templates` (GET 목록 + POST 저장)

**Files:**
- Create: `handlers/talent-search-job-templates/index.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 2의 `validateJobTemplateInput`, 기존 `requireTalentSearchAccess`, `sql`
- Produces: `GET /api/talent-search-job-templates` → `200 { templates: [{ id, name, criteria, createdAt }] }`(최신순). `POST /api/talent-search-job-templates` `{ name, criteria }` → `201 { id }`. Task 5(화면)가 둘 다 호출한다.

- [ ] **Step 1: 핸들러 작성**

```js
// handlers/talent-search-job-templates/index.js
/**
 * handlers/talent-search-job-templates/index.js
 *
 * GET  -> 200 { templates: [{ id, name, criteria, createdAt }] } (최신순 전체)
 * POST { name, criteria } -> 201 { id }
 *
 * Phase 1C: "직무 템플릿 저장/불러오기". criteria는 검색 프로젝트 입력
 * 폼의 조건 필드(프로젝트명 제외) 스냅샷을 프론트가 그대로 담아 보낸 것
 * -- 서버는 구조를 깊게 검증하지 않고 object인지만 확인한다(기준
 * 관리센터의 정책 jsonb와 같은 신뢰 모델). 인재검색 접근권한이 있는
 * 사람 전체가 공유해서 본다(만든 사람과 무관 -- 내부 소규모 팀 공용
 * 도구, talent_search_policy_versions와 같은 공유 모델).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { validateJobTemplateInput } from '../_lib/talentSearchProjectValidate.js';

function template_out(row) {
  return { id: row.id, name: row.name, criteria: row.criteria, createdAt: row.created_at };
}

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  if (req.method === 'GET') {
    try {
      const rows = await sql`SELECT * FROM talent_search_job_templates ORDER BY created_at DESC`;
      return res.status(200).json({ templates: rows.map(template_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '직무 템플릿을 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const validationError = validateJobTemplateInput(body);
    if (validationError) return res.status(400).json({ error: validationError });
    try {
      const [row] = await sql`
        INSERT INTO talent_search_job_templates (name, criteria, created_by)
        VALUES (${body.name.trim()}, ${JSON.stringify(body.criteria)}::jsonb, ${account.id})
        RETURNING id`;
      return res.status(201).json({ id: row.id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '직무 템플릿을 저장하지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 2: 라우트 등록**

`api/[...path].js`에 import 추가 (Task 3에서 추가한 `talentSearchProjectsIndex` import 줄 다음):

```js
import talentSearchJobTemplatesIndex from '../handlers/talent-search-job-templates/index.js';
```

`ROUTES` 배열에 항목 추가 (`talent-search-projects` 항목 다음):

```js
  { pattern: ['talent-search-job-templates'], handler: talentSearchJobTemplatesIndex },
```

- [ ] **Step 3: 수동 확인**

Run(같은 쿠키 재사용):
```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/talent-search-job-templates -H "Content-Type: application/json" -d '{"name":"수동확인용 템플릿","criteria":{"roleTitle":"리빙상품 기획MD","employmentType":"정규직"}}'
```
Expected: `201 {"id":"<uuid>"}`

Run:
```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-job-templates
```
Expected: `200 {"templates":[{"id":"...","name":"수동확인용 템플릿","criteria":{...},"createdAt":"..."}]}` (방금 만든 게 최신순 맨 앞)

Run: `name` 없이 POST → `400 {"error":"템플릿 이름을 입력해주세요"}` 확인

- [ ] **Step 4: Commit**

```bash
git add "handlers/talent-search-job-templates/index.js" "api/[...path].js"
git commit -m "feat: 인재검색 직무 템플릿 저장(POST)/목록(GET) 엔드포인트 추가"
```

---

### Task 5: 화면 — "+ 새 인재검색" 버튼과 입력 폼

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 3의 `POST /talent-search-projects`, Task 4의 `GET`/`POST /talent-search-job-templates`, 기존 `apiGet`/`apiPost`/`escapeHtml`/`switchTalentSearchTab`
- Produces: 없음(화면 종단)

- [ ] **Step 1: 대시보드 안내문구 갱신 + "+ 새 인재검색" 버튼 추가**

현재(`index.html`):
```html
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
        <button class="tab" onclick="switchTalentSearchTab('versions')" id="tstab-versions">버전 이력</button>
      </div>
      <div id="talentsearch-dashboard">
        <div class="section">
          <div class="section-head"><div><h3>검색 프로젝트</h3><div class="desc">아직 화면 골격만 만든 단계라, 실제로 검색 프로젝트를 만드는 기능은 다음 단계에서 추가돼요</div></div></div>
          <div id="talentsearch-projects"></div>
        </div>
      </div>
```

이걸 아래로 교체:

```html
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
        <button class="tab" onclick="switchTalentSearchTab('versions')" id="tstab-versions">버전 이력</button>
      </div>
      <div id="talentsearch-dashboard">
        <div class="section">
          <div class="section-head"><div><h3>검색 프로젝트</h3><div class="desc">"+ 새 인재검색"으로 검색 프로젝트를 만들 수 있어요 (아직 이 목록 카드에는 연동 안 됨)</div></div></div>
          <div id="talentsearch-projects"></div>
        </div>
      </div>
```

- [ ] **Step 2: `switchTalentSearchTab`이 대시보드 탭으로 돌아올 때 카드 목록으로 리셋되게 수정**

현재:
```js
function switchTalentSearchTab(tab){
  ['dashboard','policy','versions'].forEach(t=>{
    document.getElementById('talentsearch-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('tstab-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='policy') loadAndRenderTalentSearchPolicy();
  if(tab==='versions') loadAndRenderTalentSearchVersions();
}
```

이걸 아래로 교체:

```js
function switchTalentSearchTab(tab){
  ['dashboard','policy','versions'].forEach(t=>{
    document.getElementById('talentsearch-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('tstab-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='dashboard') renderTalentSearchDashboard();
  if(tab==='policy') loadAndRenderTalentSearchPolicy();
  if(tab==='versions') loadAndRenderTalentSearchVersions();
}
```

- [ ] **Step 3: `renderTalentSearchDashboard()`에 "+ 새 인재검색" 버튼 추가**

현재:
```js
function renderTalentSearchDashboard(){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  const sample = [
    {title:'이커머스 리빙상품 기획MD', sub:'대리급 · 정규직 · 서울', today:0, todayCap:50, cumulative:0, target:50},
    {title:'콘텐츠팀 영상PD', sub:'경력 3~5년 · 정규직 · 서울', today:0, todayCap:50, cumulative:0, target:30}
  ];
  el.innerHTML = `
    <div style="margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;font-size:12.5px;color:var(--sub);">
      아직 실제 검색 프로젝트를 만드는 기능은 없어요 — 화면이 완성되면 이렇게 카드로 보이게 될 거예요. 아래 2개는 예시예요.
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
      ${sample.map(p=>`
        <div class="section" style="margin-bottom:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div>
              <div style="font-size:15px;font-weight:800;">${escapeHtml(p.title)}</div>
              <div style="font-size:12px;color:var(--sub);margin-top:2px;">${escapeHtml(p.sub)}</div>
            </div>
            <span class="badge grey">예시</span>
          </div>
          <div style="display:flex;gap:10px;">
            <div class="kpi" style="flex:1;margin-bottom:0;"><div class="label">오늘 추천</div><div class="value">${p.today} / ${p.todayCap}</div></div>
            <div class="kpi" style="flex:1;margin-bottom:0;"><div class="label">누적 추천</div><div class="value">${p.cumulative} / ${p.target}</div></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
```

이걸 아래로 교체:

```js
function renderTalentSearchDashboard(){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  const sample = [
    {title:'이커머스 리빙상품 기획MD', sub:'대리급 · 정규직 · 서울', today:0, todayCap:50, cumulative:0, target:50},
    {title:'콘텐츠팀 영상PD', sub:'경력 3~5년 · 정규직 · 서울', today:0, todayCap:50, cumulative:0, target:30}
  ];
  el.innerHTML = `
    <button class="btn primary sm" style="margin-bottom:14px;" onclick="openNewTalentSearchForm()">+ 새 인재검색</button>
    <div style="margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;font-size:12.5px;color:var(--sub);">
      새로 만든 검색 프로젝트는 아직 이 카드 목록에 나오지 않아요(다음 단계에서 연동돼요). 아래 2개는 예시예요.
    </div>
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
      ${sample.map(p=>`
        <div class="section" style="margin-bottom:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div>
              <div style="font-size:15px;font-weight:800;">${escapeHtml(p.title)}</div>
              <div style="font-size:12px;color:var(--sub);margin-top:2px;">${escapeHtml(p.sub)}</div>
            </div>
            <span class="badge grey">예시</span>
          </div>
          <div style="display:flex;gap:10px;">
            <div class="kpi" style="flex:1;margin-bottom:0;"><div class="label">오늘 추천</div><div class="value">${p.today} / ${p.todayCap}</div></div>
            <div class="kpi" style="flex:1;margin-bottom:0;"><div class="label">누적 추천</div><div class="value">${p.cumulative} / ${p.target}</div></div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}
```

- [ ] **Step 4: 입력 폼 렌더링 + draft 상태 관리 함수 추가**

`renderTalentSearchDashboard()` 함수가 끝나는 `}` 바로 다음에 추가:

```js
const TS_PLATFORMS = ['사람인', '잡코리아', '리멤버', '원티드'];
let tsProjectDraft = null;
let tsJobTemplates = [];

async function openNewTalentSearchForm(){
  tsProjectDraft = {
    title:'', roleTitle:'', seniorityLevel:'', experienceMinYears:'', experienceMaxYears:'',
    employmentType:'', headcount:'', location:'',
    workConditions:{ expectedStartDate:'', salaryRange:'', workArrangement:'', requiredQualifications:'', avoidConditions:'' },
    naturalLanguageBrief:'',
    keywords:{ include:'', or:'', exact:'', exclude:'', preferred:'' },
    targetRecommendCount:'', platforms:[],
    saveAsTemplate:false, templateName:''
  };
  try{ const { templates } = await apiGet('/talent-search-job-templates'); tsJobTemplates = templates; }
  catch(err){ tsJobTemplates = []; }
  renderNewTalentSearchForm();
}

function renderNewTalentSearchForm(){
  const d = tsProjectDraft;
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `
    <div class="field"><label>직무 템플릿 불러오기</label>
      <select id="f-ts-template-load" onchange="loadTemplateIntoForm(this.value)">
        <option value="">선택 안 함</option>
        ${tsJobTemplates.map((t,i)=>`<option value="${i}">${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>검색 프로젝트명</label><input id="f-ts-title" value="${escapeHtml(d.title)}" placeholder="예: 2026년 8월 리빙MD 채용"></div>
    <div class="form-row">
      <div class="field"><label>채용 직무/포지션명</label><input id="f-ts-role" value="${escapeHtml(d.roleTitle)}" placeholder="예: 리빙상품 기획MD"></div>
      <div class="field"><label>직급/역할수준</label><input id="f-ts-level" value="${escapeHtml(d.seniorityLevel)}" placeholder="예: 대리급"></div>
    </div>
    <div class="form-row3">
      <div class="field"><label>희망 경력(최소, 년)</label><input id="f-ts-expmin" type="number" min="0" value="${escapeHtml(String(d.experienceMinYears))}"></div>
      <div class="field"><label>희망 경력(최대, 년)</label><input id="f-ts-expmax" type="number" min="0" value="${escapeHtml(String(d.experienceMaxYears))}"></div>
      <div class="field"><label>고용형태</label><input id="f-ts-employment" value="${escapeHtml(d.employmentType)}" placeholder="예: 정규직"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>채용인원</label><input id="f-ts-headcount" type="number" min="1" value="${escapeHtml(String(d.headcount))}"></div>
      <div class="field"><label>근무지역</label><input id="f-ts-location" value="${escapeHtml(d.location)}" placeholder="예: 서울"></div>
    </div>
    <div class="field"><label>찾고 싶은 사람 (자연어로 설명해주세요)</label><textarea id="f-ts-brief" style="min-height:120px;" placeholder="예: 이커머스 리빙상품 기획MD 대리급을 찾는다. 시장조사만 한 사람보다 실제 상품 출시와 리오더를 끝까지 운영한 사람이 필요하다.">${escapeHtml(d.naturalLanguageBrief)}</textarea></div>
    <div class="form-row">
      <div class="field"><label>반드시 포함할 키워드 (쉼표로 구분)</label><input id="f-ts-kw-include" value="${escapeHtml(d.keywords.include)}"></div>
      <div class="field"><label>OR 검색 키워드 (쉼표로 구분)</label><input id="f-ts-kw-or" value="${escapeHtml(d.keywords.or)}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>정확히 일치할 문구 (쉼표로 구분)</label><input id="f-ts-kw-exact" value="${escapeHtml(d.keywords.exact)}"></div>
      <div class="field"><label>제외할 키워드 (쉼표로 구분)</label><input id="f-ts-kw-exclude" value="${escapeHtml(d.keywords.exclude)}"></div>
    </div>
    <div class="field"><label>우대 키워드 (쉼표로 구분)</label><input id="f-ts-kw-preferred" value="${escapeHtml(d.keywords.preferred)}"></div>
    <div class="form-row">
      <div class="field"><label>총 적합 추천 목표 인원</label><input id="f-ts-target" type="number" min="1" value="${escapeHtml(String(d.targetRecommendCount))}"></div>
      <div class="field"><label>검색할 플랫폼</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;">
          ${TS_PLATFORMS.map((p,i)=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;"><input type="checkbox" id="f-ts-platform-${i}" ${d.platforms.includes(p)?'checked':''}> ${p}</label>`).join('')}
        </div>
      </div>
    </div>
    <details style="margin:14px 0;">
      <summary style="cursor:pointer;font-weight:700;font-size:13px;">상세조건 (선택, 안 채워도 감점되지 않아요)</summary>
      <div class="form-row" style="margin-top:10px;">
        <div class="field"><label>희망 입사가능 시점</label><input id="f-ts-startdate" value="${escapeHtml(d.workConditions.expectedStartDate)}"></div>
        <div class="field"><label>연봉·보상 범위</label><input id="f-ts-salary" value="${escapeHtml(d.workConditions.salaryRange)}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>출근/재택/출장 조건</label><input id="f-ts-arrangement" value="${escapeHtml(d.workConditions.workArrangement)}"></div>
        <div class="field"><label>필수 자격·언어·포트폴리오</label><input id="f-ts-quals" value="${escapeHtml(d.workConditions.requiredQualifications)}"></div>
      </div>
      <div class="field"><label>반드시 피해야 할 업무환경/경력유형</label><input id="f-ts-avoid" value="${escapeHtml(d.workConditions.avoidConditions)}"></div>
    </details>
    <div style="margin:10px 0;">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
        <input type="checkbox" id="f-ts-savetemplate" ${d.saveAsTemplate?'checked':''} onchange="tsProjectDraft.saveAsTemplate=this.checked; renderTsTemplateNameField();">
        이 조건을 직무 템플릿으로도 저장
      </label>
    </div>
    <div id="ts-template-name-field">${d.saveAsTemplate ? `<div class="field"><label>템플릿 이름</label><input id="f-ts-templatename" value="${escapeHtml(d.templateName)}" placeholder="예: 리빙MD 대리급"></div>` : ''}</div>
    <div id="ts-form-error" style="display:none;color:var(--red);font-size:12.5px;margin:10px 0;"></div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn" onclick="switchTalentSearchTab('dashboard')">취소</button>
      <button class="btn primary" onclick="submitNewTalentSearchProject()">검색기준 만들기</button>
    </div>
  `;
}

function renderTsTemplateNameField(){
  const el = document.getElementById('ts-template-name-field');
  if(!el) return;
  el.innerHTML = tsProjectDraft.saveAsTemplate
    ? `<div class="field"><label>템플릿 이름</label><input id="f-ts-templatename" value="${escapeHtml(tsProjectDraft.templateName)}" placeholder="예: 리빙MD 대리급"></div>`
    : '';
}

function loadTemplateIntoForm(idxStr){
  if(idxStr===''){ return; }
  const t = tsJobTemplates[Number(idxStr)];
  if(!t) return;
  const c = t.criteria || {};
  tsProjectDraft = {
    ...tsProjectDraft,
    roleTitle: c.roleTitle || '',
    seniorityLevel: c.seniorityLevel || '',
    experienceMinYears: c.experienceMinYears ?? '',
    experienceMaxYears: c.experienceMaxYears ?? '',
    employmentType: c.employmentType || '',
    headcount: c.headcount ?? '',
    location: c.location || '',
    workConditions: c.workConditions || tsProjectDraft.workConditions,
    naturalLanguageBrief: c.naturalLanguageBrief || '',
    keywords: {
      include: (c.keywords?.include || []).join(', '),
      or: (c.keywords?.or || []).join(', '),
      exact: (c.keywords?.exact || []).join(', '),
      exclude: (c.keywords?.exclude || []).join(', '),
      preferred: (c.keywords?.preferred || []).join(', ')
    },
    targetRecommendCount: c.targetRecommendCount ?? '',
    platforms: c.platforms || []
  };
  renderNewTalentSearchForm();
}
```

- [ ] **Step 5: 제출/추가질문 시뮬레이션/저장 로직 추가**

`loadTemplateIntoForm` 함수 바로 다음에 추가:

```js
function captureNewTalentSearchForm(){
  const d = tsProjectDraft;
  d.title = document.getElementById('f-ts-title').value;
  d.roleTitle = document.getElementById('f-ts-role').value;
  d.seniorityLevel = document.getElementById('f-ts-level').value;
  d.experienceMinYears = document.getElementById('f-ts-expmin').value;
  d.experienceMaxYears = document.getElementById('f-ts-expmax').value;
  d.employmentType = document.getElementById('f-ts-employment').value;
  d.headcount = document.getElementById('f-ts-headcount').value;
  d.location = document.getElementById('f-ts-location').value;
  d.naturalLanguageBrief = document.getElementById('f-ts-brief').value;
  d.keywords.include = document.getElementById('f-ts-kw-include').value;
  d.keywords.or = document.getElementById('f-ts-kw-or').value;
  d.keywords.exact = document.getElementById('f-ts-kw-exact').value;
  d.keywords.exclude = document.getElementById('f-ts-kw-exclude').value;
  d.keywords.preferred = document.getElementById('f-ts-kw-preferred').value;
  d.targetRecommendCount = document.getElementById('f-ts-target').value;
  d.platforms = TS_PLATFORMS.filter((p,i)=>document.getElementById('f-ts-platform-'+i).checked);
  d.workConditions = {
    expectedStartDate: document.getElementById('f-ts-startdate').value,
    salaryRange: document.getElementById('f-ts-salary').value,
    workArrangement: document.getElementById('f-ts-arrangement').value,
    requiredQualifications: document.getElementById('f-ts-quals').value,
    avoidConditions: document.getElementById('f-ts-avoid').value
  };
  d.saveAsTemplate = document.getElementById('f-ts-savetemplate').checked;
  const nameEl = document.getElementById('f-ts-templatename');
  d.templateName = nameEl ? nameEl.value : '';
}

function showTsFormError(msg){
  const box = document.getElementById('ts-form-error');
  if(!box){ alert(msg); return; }
  box.textContent = msg;
  box.style.display = 'block';
}

function splitKeywords(s){
  return String(s||'').split(',').map(x=>x.trim()).filter(Boolean);
}

// 원본 명세: "핵심 정보가 빠져 직무 기준을 만들 수 없을 때만 추가 질문을
// 한다... 최대 3개로 제한한다." 로컬 모델(Phase 2, 아직 없음) 없이 이
// 조건들을 규칙으로만 흉내낸다 -- 실제 AI 판단이 아니라 화면 흐름
// 시뮬레이션이다.
function computeClarificationQuestions(d){
  const qs = [];
  if(!d.naturalLanguageBrief || d.naturalLanguageBrief.trim().length < 30){
    qs.push('이 직무에서 반드시 확인해야 할 과거 성과나 경험이 있다면 설명해주세요');
  }
  if(!splitKeywords(d.keywords.include).length){
    qs.push('반드시 포함되어야 할 키워드가 있다면 알려주세요');
  }
  if(!splitKeywords(d.keywords.exclude).length){
    qs.push('반드시 피해야 할 경력유형이나 업무환경이 있나요?');
  }
  return qs.slice(0, 3);
}

let tsClarifyQuestions = [];

function submitNewTalentSearchProject(){
  captureNewTalentSearchForm();
  const d = tsProjectDraft;
  if(!d.title.trim()) return showTsFormError('검색 프로젝트명을 입력해주세요');
  if(!d.roleTitle.trim()) return showTsFormError('채용 직무/포지션명을 입력해주세요');
  if(!d.employmentType.trim()) return showTsFormError('고용형태를 입력해주세요');
  if(!d.headcount || Number(d.headcount) < 1) return showTsFormError('채용인원을 1명 이상 입력해주세요');
  if(!d.targetRecommendCount || Number(d.targetRecommendCount) < 1) return showTsFormError('총 적합 추천 목표 인원을 1명 이상 입력해주세요');
  if(!d.platforms.length) return showTsFormError('검색할 플랫폼을 1개 이상 선택해주세요');
  if(d.saveAsTemplate && !d.templateName.trim()) return showTsFormError('템플릿 이름을 입력해주세요');

  tsClarifyQuestions = computeClarificationQuestions(d);
  if(tsClarifyQuestions.length){
    showModal(`
      <h3>몇 가지만 더 확인할게요</h3>
      <div class="modal-sub">입력한 내용만으로는 직무 기준을 만들기에 정보가 조금 부족해요 — 답하지 않고 넘어가도 괜찮아요</div>
      ${tsClarifyQuestions.map((q,i)=>`<div class="field"><label>${escapeHtml(q)}</label><input id="f-ts-clarify-${i}" placeholder="답하지 않아도 괜찮아요"></div>`).join('')}
      <div class="modal-actions"><button class="btn" onclick="closeModal()">뒤로</button><button class="btn primary" onclick="confirmClarificationAndSave()">확인하고 저장</button></div>
    `);
    return;
  }
  saveNewTalentSearchProject([]);
}

function confirmClarificationAndSave(){
  const notes = tsClarifyQuestions.map((q,i)=>({
    question: q,
    answer: document.getElementById('f-ts-clarify-'+i).value.trim()
  }));
  closeModal();
  saveNewTalentSearchProject(notes);
}

async function saveNewTalentSearchProject(clarificationNotes){
  const d = tsProjectDraft;
  const criteria = {
    roleTitle: d.roleTitle.trim(),
    seniorityLevel: d.seniorityLevel.trim() || null,
    experienceMinYears: d.experienceMinYears ? Number(d.experienceMinYears) : null,
    experienceMaxYears: d.experienceMaxYears ? Number(d.experienceMaxYears) : null,
    employmentType: d.employmentType.trim(),
    headcount: Number(d.headcount),
    location: d.location.trim() || null,
    workConditions: d.workConditions,
    naturalLanguageBrief: d.naturalLanguageBrief.trim() || null,
    keywords: {
      include: splitKeywords(d.keywords.include),
      or: splitKeywords(d.keywords.or),
      exact: splitKeywords(d.keywords.exact),
      exclude: splitKeywords(d.keywords.exclude),
      preferred: splitKeywords(d.keywords.preferred)
    },
    targetRecommendCount: Number(d.targetRecommendCount),
    platforms: d.platforms
  };
  const payload = { title: d.title.trim(), ...criteria, clarificationNotes };

  try{
    await apiPost('/talent-search-projects', payload);
  }catch(err){
    showTsFormError(err.message);
    return;
  }

  if(d.saveAsTemplate){
    try{ await apiPost('/talent-search-job-templates', { name: d.templateName.trim(), criteria }); }
    catch(err){ /* 템플릿 저장 실패는 이미 만들어진 검색 프로젝트를 되돌리지 않음 */ }
  }

  alert('검색 프로젝트가 만들어졌어요. 검색기준 확인·승인 화면은 다음 단계에서 만들 예정이에요.');
  switchTalentSearchTab('dashboard');
}
```

- [ ] **Step 6: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000 재사용 시 재시작), 브라우저에서 ADMIN 테스트 계정(`preview-test@selfdiylab.invalid`/`Preview1234`)으로 로그인 → 인재검색 → 대시보드

Expected:
1. "+ 새 인재검색" 클릭 → 입력 폼이 카드 목록 대신 나타남
2. 프로젝트명·직무·고용형태·채용인원·목표인원·플랫폼 1개만 채우고(자연어 설명은 비워둠) "검색기준 만들기" 클릭 → 자연어 설명이 비어있어서 추가질문 모달이 뜸(3개 중 1~3개, 자연어/포함키워드/제외키워드 조건에 따라) → 아무것도 안 채우고 "확인하고 저장" → 성공 알림 → 대시보드 카드 목록으로 복귀
3. SQL로 직접 확인: `node -e "import('./handlers/_lib/db.js').then(async({sql})=>{const rows=await sql\`SELECT title, role_title, employment_type, headcount, target_recommend_count, platforms, keywords, clarification_notes, status FROM talent_search_projects ORDER BY created_at DESC LIMIT 1\`; console.log(JSON.stringify(rows[0], null, 2));})"` — 방금 만든 프로젝트가 `status:'draft'`로 저장돼 있고 `clarification_notes`에 방금 입력한 답변(빈 문자열 포함)이 들어있는지 확인
4. "+ 새 인재검색"을 다시 열고, 자연어 설명을 40자 이상 채우고 포함/제외 키워드도 채운 뒤 제출 → 추가질문 모달 없이 곧바로 저장되는지 확인
5. "+ 새 인재검색"을 다시 열고 모든 필드를 채운 뒤 "이 조건을 직무 템플릿으로도 저장" 체크 → 템플릿 이름 입력 → 제출 → SQL로 `SELECT name, criteria FROM talent_search_job_templates ORDER BY created_at DESC LIMIT 1`로 저장 확인(criteria에 `title`이 없는지도 확인 — 템플릿은 프로젝트명을 안 담아야 함)
6. "+ 새 인재검색"을 다시 열고 "직무 템플릿 불러오기"에서 방금 만든 템플릿을 선택 → 직무/직급/경력/키워드 등 필드가 자동으로 채워지는지 확인(검색 프로젝트명은 안 채워지는지도 확인)
7. 필수값(예: 채용 직무)을 비우고 제출 → 폼 안에 빨간 에러 메시지가 뜨고 폼이 사라지지 않는지 확인

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: 인재검색 대시보드에 새 검색 프로젝트 입력 폼 추가(추가질문 시뮬레이션, 직무템플릿 저장/불러오기)"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙(`2026-08-25-talent-search-phase1c-design.md`)의 "포함" 항목 — 키워드/추가질문답변 컬럼 보강(Task 1), 직무템플릿 테이블(Task 1), 검증 로직(Task 2), 프로젝트 생성 API(Task 3), 템플릿 저장/목록 API(Task 4), "+ 새 인재검색" 버튼과 폼·추가질문 시뮬레이션·템플릿 불러오기/저장(Task 5) 전부 매핑됨. "포함 안 함"(1D/1E, 대시보드 카드 연동, 프로젝트 목록 GET, 실제 AI 연결, 템플릿 관리 화면)은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음.
- **타입/이름 일관성**: API 필드(`roleTitle`/`seniorityLevel`/`experienceMinYears`/`experienceMaxYears`/`employmentType`/`headcount`/`location`/`workConditions`/`naturalLanguageBrief`/`keywords`/`targetRecommendCount`/`platforms`/`clarificationNotes`)가 Task 2(검증)→Task 3(핸들러)→Task 5(폼 캡처/저장)에서 동일하게 유지됨. `TALENT_SEARCH_PLATFORMS`(서버, Task 2)와 `TS_PLATFORMS`(클라이언트, Task 5)는 이름은 다르지만 값(`['사람인','잡코리아','리멤버','원티드']`)이 동일 — 클라이언트가 별도 상수를 갖는 건 기존 코드베이스에 프론트-서버 공유 모듈이 없어서(다른 곳도 다 이렇게 함, 예: `isEditableMonth`류 로직은 각자 따로 구현) 기존 패턴과 일치. `validateTalentSearchProjectInput`/`validateJobTemplateInput` 함수명이 Task 2의 export 선언, 테스트 import, Task 3/4의 핸들러 import에서 일관됨. `tsProjectDraft`/`tsJobTemplates`/`tsClarifyQuestions` 전역 변수명이 Task 5 안에서 일관되게 참조됨.

## 실행 순서 안내

Task 1(마이그레이션) → Task 2(검증 로직, Task 1과 독립적이나 먼저 해두면 Task 3/4가 바로 이어짐) → Task 3(프로젝트 생성 API, Task 1+2 필요) → Task 4(템플릿 API, Task 1+2 필요, Task 3과는 서로 독립적) → Task 5(화면, Task 3+4의 API 필요) 순서로 진행.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 "+ 새 인재검색" 클릭 → 폼 작성 → 추가질문 모달 → 저장 → 대시보드 복귀까지 실제 화면 캡처
2. 직무 템플릿 저장 후 다시 불러오기로 필드가 채워지는 화면 캡처
3. 각 Task의 수동 확인 절차 통과 결과, 단위테스트 통과 결과(13개)
4. 다음 단계(1D: 검색기준 확인·승인 화면) 착수 여부, 그리고 이번에 미룬 "프로덕션 마이그레이션 반영" 여부도 다시 확인
