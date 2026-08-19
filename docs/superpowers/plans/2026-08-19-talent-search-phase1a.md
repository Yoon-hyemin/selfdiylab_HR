# 인재검색 Phase 1A (사이드바 메뉴 + 대시보드 골격 + 권한 플래그) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인재검색 자동화 기능의 첫 화면 골격을 실제 HR 웹사이트(Vercel+Neon)에 추가한다 — 사이드바 "인재검색" 메뉴, 대시보드 빈 상태 + 예시 카드 2개, 그리고 "채용담당자만 볼 수 있게"를 위한 계정별 권한 플래그(`can_use_talent_search`)를 계정 관리 화면에서 켜고 끌 수 있게 만든다.

**Architecture:** 기존 패턴을 그대로 따른다 — Neon Postgres에 마이그레이션 파일 추가, `handlers/`에 얇은 서버리스 핸들러 추가, `api/[...path].js`에 라우트 등록, `index.html`(단일 SPA)에 사이드바 버튼·뷰 컨테이너·렌더 함수 추가. 이번 범위에서는 검색 프로젝트를 실제로 만드는 기능은 없다 — 대시보드의 카드 2개는 레이아웃을 보여주기 위한 하드코딩된 예시일 뿐, 실제 API 호출은 없다 (실제 생성/조회는 Phase 1C~1E에서 추가).

**Tech Stack:** Vanilla JS(프론트, `index.html` 내 인라인 `<script>`), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`, 순수 SQL 마이그레이션 파일.

## Global Constraints

- 새 테이블/컬럼 이름은 스펙 문서(`docs/superpowers/specs/2026-08-19-talent-search-automation-design.md`)와 정확히 일치시킨다: `accounts.can_use_talent_search`, `talent_search_projects`.
- API 응답 필드는 camelCase, DB 컬럼은 snake_case — 매핑은 `handlers/_lib/accountAdmin.js`의 `account_out()`에서만 담당한다(기존 컨벤션).
- 새 엔드포인트를 추가하면 반드시 `api/[...path].js`의 import + `ROUTES` 배열에도 등록한다 — 로컬 `dev-server.js`는 파일시스템 기반이라 등록 없이도 동작하지만 Vercel 배포에는 이 파일이 유일한 진입점이다.
- ADMIN은 `can_use_talent_search` 값과 무관하게 항상 인재검색 메뉴에 접근 가능하다(기존 "ADMIN은 부서장 전용 기능도 전부 접근 가능" 원칙과 동일).
- 비밀번호·세션 토큰 값은 감사 로그(`audit_log.metadata`)에 절대 넣지 않는다(기존 규칙).
- 이 프로젝트는 순수 계산 로직만 `node --test`로 단위테스트하고(예: `handlers/_lib/kpiCalc.test.js`), DB/HTTP/UI가 얽힌 동작은 로컬 dev 서버 브라우저 수동 검증으로 확인하는 컨벤션을 쓴다(`handlers/_lib/kpiCalc.test.js` 상단 주석 참고). 이번 Phase는 전부 DB/HTTP/UI 통합 작업이라 새 단위테스트 파일은 추가하지 않고, 각 Task에 구체적인 수동 검증 절차를 포함한다.
- 프로덕션 Neon DB에 마이그레이션을 실제로 적용하는 것(`DATABASE_URL`이 프로덕션을 가리킨 상태로 `node scripts/run-sql.js` 실행, 또는 Vercel 배포)은 이 저장소의 안전 원칙상 사용자 확인 후에 진행한다 — 이 계획의 각 Task는 로컬 dev DB(`.env.local`)에서 검증하는 것까지를 "완료"로 본다.

---

### Task 1: SQL 마이그레이션 — `can_use_talent_search` 플래그 + `talent_search_projects` 테이블

**Files:**
- Create: `sql/015_talent_search.sql`

**Interfaces:**
- Produces: `accounts.can_use_talent_search boolean` 컬럼, `talent_search_projects` 테이블(뒤 Task들이 참조하지 않음 — 이번 Phase는 스키마만 만들고 아직 아무도 이 테이블에 쓰거나 읽지 않는다)

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- sql/015_talent_search.sql
--
-- 2026-08-19: 인재검색 자동화 기능 Phase 1A. 이 마이그레이션은 사이드바
-- 메뉴/권한 플래그와 대시보드 뼈대만 만들기 위한 최소 스키마다. 전체 목표
-- 스키마는 docs/superpowers/specs/2026-08-19-talent-search-automation-design.md
-- 참고 -- 기준 관리, 후보자, 평가 등 나머지 테이블은 Phase 1B~1E에서 별도
-- 마이그레이션으로 추가한다.
--
-- can_use_talent_search는 accounts.system_role(ADMIN/DEPARTMENT_HEAD/EMPLOYEE)과
-- 별개 축이다. ADMIN은 이 값과 무관하게 항상 접근 가능(핸들러에서 검사),
-- 그 외 역할은 이 플래그가 true일 때만 "인재검색" 메뉴가 보인다 --
-- "승인된 채용담당자"가 꼭 부서장/관리자일 필요는 없다는 요구사항 때문에
-- system_role 값을 늘리는 대신 별도 boolean으로 뺐다.
ALTER TABLE accounts ADD COLUMN can_use_talent_search boolean NOT NULL DEFAULT false;

-- 검색 프로젝트. 이번 Phase에서는 행을 만드는 화면이 없어(Phase 1C에서
-- 추가) 테이블은 비어 있는 채로 시작한다 -- 스키마를 먼저 확정해두면 이후
-- Phase에서 이 테이블에 대한 ALTER 없이 바로 API를 붙일 수 있다.
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
  work_conditions jsonb NOT NULL DEFAULT '{}',
  natural_language_brief text,
  target_recommend_count integer NOT NULL,
  daily_recommend_cap integer NOT NULL DEFAULT 50,
  platforms jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: 로컬 dev DB에 적용**

Run: `node scripts/run-sql.js sql/015_talent_search.sql`
Expected: 에러 없이 종료, 콘솔에 성공 로그 출력

- [ ] **Step 3: 적용 확인**

Run: `node -e "import('./handlers/_lib/db.js').then(async({sql})=>{console.log(await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='accounts' AND column_name='can_use_talent_search'\`); console.log(await sql\`SELECT to_regclass('talent_search_projects')\`);})"`
Expected: 첫 번째 쿼리가 `can_use_talent_search` 행 1개를 반환하고, 두 번째 쿼리가 `talent_search_projects`(null이 아님)를 반환

- [ ] **Step 4: Commit**

```bash
git add sql/015_talent_search.sql
git commit -m "feat: 인재검색 Phase 1A 스키마 -- can_use_talent_search 플래그, talent_search_projects 테이블"
```

---

### Task 2: `/api/me`가 `canUseTalentSearch` 반환

**Files:**
- Modify: `handlers/_lib/accountAuth.js:145-154` (`loadAccountById`)
- Modify: `handlers/me.js:30-37`

**Interfaces:**
- Consumes: Task 1의 `accounts.can_use_talent_search` 컬럼
- Produces: `GET /api/me` 응답에 `canUseTalentSearch: boolean` 필드 추가 — Task 5(프론트 사이드바 권한 분기)가 `me.canUseTalentSearch`로 이 값을 읽는다

- [ ] **Step 1: `loadAccountById`가 새 컬럼을 SELECT하도록 수정**

`handlers/_lib/accountAuth.js`의 `loadAccountById` 함수를 아래로 교체:

```js
export async function loadAccountById(accountId) {
  const [row] = await sql`
    SELECT a.id, a.employee_id, a.email, a.system_role, a.department_id, a.account_status,
           a.must_change_password, a.session_version, a.can_use_talent_search,
           m.name AS employee_name, m.team AS employee_team
    FROM accounts a
    JOIN members m ON m.id = a.employee_id
    WHERE a.id = ${accountId}`;
  return row || null;
}
```

- [ ] **Step 2: `handlers/me.js` 응답에 필드 추가**

`res.status(200).json({...})` 블록을 아래로 교체:

```js
  res.status(200).json({
    id: account.employee_id,
    name: account.employee_name,
    email: account.email,
    team: account.employee_team || '',
    systemRole: account.system_role,
    mustChangePassword: account.must_change_password,
    canUseTalentSearch: account.can_use_talent_search
  });
```

- [ ] **Step 3: 로컬 서버로 수동 확인**

Run: `node scripts/dev-server.js` (다른 터미널에서 계속 실행)
Run: 로그인 후(브라우저 또는 `curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"<실제 관리자 이메일>","password":"<비밀번호>"}'`), `curl -s -b cookies.txt http://localhost:3000/api/me`
Expected: JSON 응답에 `"canUseTalentSearch":false` (아직 아무도 켜지 않았으므로 기본값 false)가 포함됨

- [ ] **Step 4: Commit**

```bash
git add handlers/_lib/accountAuth.js handlers/me.js
git commit -m "feat: /api/me에 canUseTalentSearch 플래그 노출"
```

---

### Task 3: 계정 관리 API — 인재검색 권한 조회/변경

**Files:**
- Modify: `handlers/_lib/accountAdmin.js:11-29` (`account_out`)
- Create: `handlers/accounts/[id]/talent-search-access.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 컬럼, 기존 `requireRole`/`writeAuditLog`/`account_out`
- Produces: `PATCH /api/accounts/:id/talent-search-access` `{ canUseTalentSearch: boolean }` → `200 { account }` (account 객체에 `canUseTalentSearch` 필드 포함). `GET /api/accounts`(기존 엔드포인트, 변경 없음) 응답의 각 계정 객체에도 이제 `canUseTalentSearch` 필드가 포함됨 — Task 4가 이 값으로 체크박스 초기 상태를 그린다.

- [ ] **Step 1: `account_out()`에 필드 추가**

`handlers/_lib/accountAdmin.js`의 `account_out` 함수 내부, `mustChangePassword` 줄 다음에 추가:

```js
    mustChangePassword: row.must_change_password,
    canUseTalentSearch: row.can_use_talent_search,
```

- [ ] **Step 2: 새 핸들러 작성**

```js
/**
 * handlers/accounts/[id]/talent-search-access.js
 *
 * PATCH { canUseTalentSearch: boolean } -> 200 { account }
 *
 * "인재검색" 메뉴는 accounts.system_role과 별개 축인 이 플래그로 노출
 * 여부가 결정된다(ADMIN은 이 값과 무관하게 항상 접근 가능 -- 프론트
 * index.html의 applySidebarForRole에서 처리). 여기서는 단순히 플래그
 * 값을 켜고 끄는 것만 담당하고, 마지막 ADMIN 보호 같은 특수 규칙은
 * 없다(이 플래그를 끈다고 로그인 자체가 막히거나 다른 권한이 줄어들지
 * 않으므로 accounts/[id]/status.js 같은 안전장치가 필요 없다).
 */
import { sql } from '../../_lib/db.js';
import { requireRole } from '../../_lib/accountAuth.js';
import { writeAuditLog, account_out } from '../../_lib/accountAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const { id } = req.query;
  const { canUseTalentSearch } = req.body || {};
  if (typeof canUseTalentSearch !== 'boolean') return res.status(400).json({ error: '값이 올바르지 않아요' });

  try {
    const [target] = await sql`
      SELECT a.*, m.name AS employee_name, m.team AS employee_team
      FROM accounts a JOIN members m ON m.id = a.employee_id WHERE a.id = ${id}`;
    if (!target) return res.status(404).json({ error: '계정을 찾을 수 없어요' });

    const [updated] = await sql`
      UPDATE accounts SET can_use_talent_search = ${canUseTalentSearch}, updated_at = now()
      WHERE id = ${id} RETURNING *`;
    await writeAuditLog(admin.id, id, 'TALENT_SEARCH_ACCESS_CHANGE', { canUseTalentSearch });

    return res.status(200).json({ account: account_out({ ...updated, employee_name: target.employee_name, employee_team: target.employee_team }) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '권한 변경에 실패했어요' });
  }
}
```

- [ ] **Step 3: 라우트 등록**

`api/[...path].js`에 import 추가 (`accountsIdStatus` import 줄 다음):

```js
import accountsIdTalentSearchAccess from '../handlers/accounts/[id]/talent-search-access.js';
```

`ROUTES` 배열에 항목 추가 (`accounts/:id/status` 항목 다음):

```js
  { pattern: ['accounts', ':id', 'talent-search-access'], handler: accountsIdTalentSearchAccess },
```

- [ ] **Step 4: 수동 확인**

Run: `node scripts/dev-server.js` 실행 중인 상태에서, 관리자로 로그인한 쿠키로:
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/accounts/<계정id>/talent-search-access -H "Content-Type: application/json" -d '{"canUseTalentSearch": true}'
```
Expected: `{"account":{... "canUseTalentSearch":true ...}}` 응답. 이어서 `curl -s -b cookies.txt http://localhost:3000/api/accounts`로 목록을 다시 조회해 해당 계정의 `canUseTalentSearch`가 `true`로 유지되는지 확인.
Run: `curl -s -b cookies.txt http://localhost:3000/api/audit-log` — `TALENT_SEARCH_ACCESS_CHANGE` 액션이 새로 기록됐는지 확인

- [ ] **Step 5: Commit**

```bash
git add handlers/_lib/accountAdmin.js "handlers/accounts/[id]/talent-search-access.js" "api/[...path].js"
git commit -m "feat: 계정별 인재검색 권한 플래그 API 추가"
```

---

### Task 4: "계정 및 권한 관리" 화면에 인재검색 권한 체크박스 추가

**Files:**
- Modify: `index.html` (계정 테이블 헤더/행 렌더, `AUDIT_ACTION_LABELS`, 새 토글 함수)

**Interfaces:**
- Consumes: Task 3의 `PATCH /api/accounts/:id/talent-search-access`, `GET /api/accounts` 응답의 `canUseTalentSearch` 필드
- Produces: 없음(화면 종단)

- [ ] **Step 1: 감사 로그 라벨 추가**

`AUDIT_ACTION_LABELS` 객체(약 3119번째 줄)에 항목 추가:

```js
const AUDIT_ACTION_LABELS = {
  LOGIN_SUCCESS:'로그인 성공', LOGIN_FAILURE:'로그인 실패',
  PASSWORD_CHANGE_SELF:'비밀번호 변경(본인)', PASSWORD_RESET_BY_ADMIN:'비밀번호 초기화(관리자)',
  ACCOUNT_CREATED:'계정 생성', ROLE_CHANGE:'권한 변경', DEPARTMENT_CHANGE:'부서 변경',
  ACCOUNT_UNLOCKED:'잠금 해제', ACCOUNT_DEACTIVATED:'비활성화', ACCOUNT_REACTIVATED:'재활성화',
  TALENT_SEARCH_ACCESS_CHANGE:'인재검색 권한 변경'
};
```

- [ ] **Step 2: 테이블 헤더에 컬럼 추가**

`<thead><tr><th>이름</th><th>부서</th><th>이메일</th><th>권한</th><th>상태</th><th>최근 로그인</th><th></th></tr></thead>`를 아래로 교체:

```html
<thead><tr><th>이름</th><th>부서</th><th>이메일</th><th>권한</th><th>인재검색</th><th>상태</th><th>최근 로그인</th><th></th></tr></thead>
```

- [ ] **Step 3: 행 렌더에 체크박스 추가**

`renderAccounts()` 안의 각 `<tr>` 템플릿에서, 권한(`<td><select ...`) 다음 줄에 추가:

```js
    return `<tr>
      <td>${escapeHtml(a.employeeName)}</td>
      <td>${escapeHtml(a.employeeTeam||'-')}</td>
      <td>${escapeHtml(a.email)}</td>
      <td><select onchange="changeAccountRole('${a.id}', this.value)">${Object.keys(ROLE_OPTION_LABELS).map(r=>`<option value="${r}" ${a.systemRole===r?'selected':''}>${ROLE_OPTION_LABELS[r]}</option>`).join('')}</select></td>
      <td style="text-align:center;">${a.systemRole==='ADMIN'
        ? '<input type="checkbox" checked disabled title="관리자는 항상 접근 가능해요">'
        : `<input type="checkbox" ${a.canUseTalentSearch?'checked':''} onchange="toggleTalentSearchAccess('${a.id}', this.checked)">`}</td>
      <td>${statusBadge}${a.mustChangePassword?' <span class="badge grey">비번변경대기</span>':''}</td>
      <td>${a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString('ko-KR') : '-'}</td>
      <td style="white-space:nowrap;">
        <button class="btn ghost sm" onclick='openResetPasswordConfirm(${JSON.stringify(a.id)},${JSON.stringify(a.employeeName)},${JSON.stringify(a.email)})'>비밀번호 초기화</button>
        ${a.isLocked?`<button class="btn ghost sm" onclick="doUnlockAccount('${a.id}')">잠금 해제</button>`:''}
        <button class="btn ghost sm" onclick='openToggleStatusConfirm(${JSON.stringify(a.id)},${JSON.stringify(a.employeeName)},${JSON.stringify(a.accountStatus)})'>${a.accountStatus==='ACTIVE'?'비활성화':'재활성화'}</button>
      </td>
    </tr>`;
```

그리고 빈 상태의 `colspan`을 7에서 8로 변경: `<tr><td colspan="8" class="empty">생성된 계정이 없어요</td></tr>`

- [ ] **Step 4: 토글 함수 추가**

`changeAccountRole` 함수 바로 다음에 추가:

```js
async function toggleTalentSearchAccess(id, checked){
  try{ await apiPatch('/accounts/'+id+'/talent-search-access', {canUseTalentSearch: checked}); }
  catch(err){ alert(err.message); }
  await loadAndRenderAccounts();
}
```

- [ ] **Step 5: 설명 문구 추가**

계정 화면의 기존 "부서 목표 관리 권한" 설명 문구(`<div class="modal-sub" style="margin-bottom:10px;">...`) 바로 다음 줄에 추가:

```html
<div class="modal-sub" style="margin-bottom:10px;"><b>인재검색 권한</b> — 체크된 사람은 사이드바에 "인재검색" 메뉴가 보여요. 채용 업무를 맡은 팀원에게 개별로 켜주면 되고, 부서장·관리자 권한과는 무관해요. <b>관리자</b>는 이 체크와 무관하게 항상 볼 수 있어요.</div>
```

- [ ] **Step 6: 수동 확인**

Run: `node scripts/dev-server.js`, 브라우저에서 `http://localhost:3000`으로 관리자 로그인 → "계정 및 권한 관리" 화면 진입
Expected: 계정 목록 테이블에 "인재검색" 열이 보이고, ADMIN 행은 체크되어 있고 비활성화(회색, 클릭 불가)돼 있음. 팀원(EMPLOYEE) 행 하나를 체크 → 페이지 새로고침 후에도 체크 상태 유지 → 감사 로그 표에 "인재검색 권한 변경" 항목 추가됨

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: 계정 및 권한 관리 화면에 인재검색 권한 체크박스 추가"
```

---

### Task 5: 사이드바 메뉴 + 인재검색 대시보드 골격

**Files:**
- Modify: `index.html` (사이드바 nav-item, 뷰 컨테이너, `ROLE_VIEWS`/`applySidebarForRole`, `renderAll`, 새 렌더 함수)

**Interfaces:**
- Consumes: `me.systemRole`, `me.canUseTalentSearch`(Task 2)
- Produces: 없음(화면 종단) — Phase 1B 이후 이 뷰 컨테이너 안에 실제 화면(기준 관리센터 등)을 계속 추가해나간다

- [ ] **Step 1: 사이드바 버튼 추가**

`<button class="nav-item" data-view="recruit">📥 채용</button>` 바로 다음 줄에 추가:

```html
    <button class="nav-item" data-view="talentsearch">🔍 인재검색</button>
```

- [ ] **Step 2: 뷰 컨테이너 추가**

`<!-- DATA -->` 주석 바로 앞(`view-accounts` 닫는 `</div>` 다음)에 추가:

```html
    <!-- TALENT SEARCH (인재검색, ADMIN 또는 canUseTalentSearch 계정) -->
    <div class="view" id="view-talentsearch">
      <div class="page-head"><div><h1>인재검색</h1><p>여러 채용 플랫폼의 인재풀을 검색하고 평가해서 추천 후보를 정리해요</p></div></div>
      <div class="section">
        <div class="section-head"><div><h3>검색 프로젝트</h3><div class="desc">아직 화면 골격만 만든 단계라, 실제로 검색 프로젝트를 만드는 기능은 다음 단계에서 추가돼요</div></div></div>
        <div id="talentsearch-projects"></div>
      </div>
    </div>
```

- [ ] **Step 3: 사이드바 노출 로직 수정**

`applySidebarForRole()` 함수를 아래로 교체:

```js
function applySidebarForRole(){
  const allowed = ROLE_VIEWS[me.systemRole] || [];
  const canSeeTalentSearch = me.systemRole==='ADMIN' || !!me.canUseTalentSearch;
  document.querySelectorAll('.nav-item').forEach(btn=>{
    const view = btn.dataset.view;
    const visible = view==='talentsearch' ? canSeeTalentSearch : allowed.includes(view);
    btn.style.display = visible ? '' : 'none';
  });
  document.querySelectorAll('.nav-sep').forEach(sep=>{
    let sib = sep.nextElementSibling, anyVisible = false;
    while(sib && sib.classList && !sib.classList.contains('nav-sep')){
      if(sib.style.display !== 'none') anyVisible = true;
      sib = sib.nextElementSibling;
    }
    sep.style.display = anyVisible ? '' : 'none';
  });
}
```

(`talentsearch`를 `ROLE_VIEWS`의 어떤 배열에도 넣지 않는다 — ADMIN조차 그 배열이 아니라 위 특수 분기로 처리되므로, 이 함수 하나만 고치면 된다.)

- [ ] **Step 4: 렌더 함수 추가 + `renderAll()`에 연결**

`renderJobs()` 함수 앞(또는 `/* ---------- RECRUIT RENDER ---------- */` 섹션 다음)에 추가:

```js
/* ---------- TALENT SEARCH (인재검색) ---------- */
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

`renderAll()` 함수 안, `renderRevenue();` 다음 줄에 추가:

```js
  renderTalentSearchDashboard();
```

- [ ] **Step 5: 수동 확인 — ADMIN 계정**

Run: `node scripts/dev-server.js`, 브라우저에서 관리자로 로그인
Expected: 사이드바에 "🔍 인재검색" 메뉴가 보임 → 클릭 → 대시보드에 "예시" 배지가 붙은 카드 2개(이커머스 리빙상품 기획MD, 콘텐츠팀 영상PD)가 오늘/누적 추천 숫자와 함께 보임

- [ ] **Step 6: 수동 확인 — 권한 없는 팀원 계정**

Run: Task 4에서 체크박스를 켜지 않은 EMPLOYEE 계정으로 로그인
Expected: 사이드바에 "인재검색" 메뉴가 보이지 않음
Run: 같은 계정에서 Task 4의 체크박스를 켠 뒤(관리자 계정으로 다시 켜준 뒤) 그 계정으로 재로그인
Expected: 이번엔 "인재검색" 메뉴가 보임

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: 인재검색 사이드바 메뉴 + 대시보드 골격(예시 카드) 추가"
```

---

## Self-Review 결과 (계획 작성자가 미리 확인함)

- **스펙 커버리지**: 설계 문서의 Phase 1A 항목("사이드바 메뉴", "대시보드 빈 상태 + 가상 카드 2개", "권한 플래그 적용") 전부 Task 1~5에 매핑됨. 실제 검색 프로젝트 생성/조회 API는 의도적으로 이번 범위 밖(Phase 1C).
- **플레이스홀더 스캔**: "TBD"/"나중에" 없음. 모든 코드 블록은 그대로 붙여넣을 수 있는 완성된 내용.
- **타입/이름 일관성**: `canUseTalentSearch`(camelCase, API/프론트) ↔ `can_use_talent_search`(snake_case, DB) 매핑이 Task 2/3/4/5 전체에서 동일하게 유지됨. `talent-search-access`(엔드포인트 경로)와 `talentsearch`(프론트 `data-view` 값)는 일부러 다른 문자열이다 — 전자는 REST 경로 컨벤션(하이픈), 후자는 기존 `data-view` 값들(`hrdash`, `perfdash` 등 공백·하이픈 없는 소문자)과 통일한 것.

## 실행 순서 안내

Task 1(스키마) → Task 2(me 응답) → Task 3(계정 API) → Task 4(계정 화면 체크박스) → Task 5(사이드바+대시보드) 순서로 진행해야 한다 — Task 4는 Task 3의 엔드포인트를, Task 5의 확인 절차는 Task 4에서 켠 플래그를 전제로 하기 때문이다.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버 화면 캡처(사이드바 메뉴, 대시보드 예시 카드, 계정 화면 체크박스)
2. 위 각 Task의 수동 확인 절차를 실제로 통과했다는 결과
3. 다음 단계(Phase 1B: 기준 관리센터) 착수 여부 확인
