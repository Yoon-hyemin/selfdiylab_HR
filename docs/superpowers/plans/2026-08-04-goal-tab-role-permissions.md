# 목표 탭 역할별(관리자/부서장/팀원) 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 🎯목표 탭을 전체현황/부서목표/개인목표 3개 서브탭으로 재구성하고, 관리자(회사 목표만)/부서장(자기 팀 목표만)/팀원(개인 목표만)으로 실제 서버 권한을 나누고, 월 편집 가능 범위를 "이번 달+지난달"로 제한한다.

**Architecture:** 기존 패턴(정적 `index.html` + Vercel 서버리스 `/api/*` 단일 catch-all + Neon Postgres, 클라이언트가 전체 데이터를 한 번에 받아 렌더링/집계) 그대로 확장. 새 엔드포인트는 추가하지 않고 기존 핸들러 5개(okrs, my-goals, okr-tasks×2, me, members×2, all, public-data)만 수정한다.

**Tech Stack:** Vanilla JS(프론트), Vercel Node 서버리스 함수(`handlers/*.js`), Neon Postgres(`@neondatabase/serverless`), 신규 의존성 없음.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md` — 이 계획의 모든 결정은 이 문서를 따른다.
- 새 npm 의존성 추가 금지.
- 조회(GET)는 계속 로그인 없이 전체 공개 — 역할 검사는 생성(POST)에만 건다.
- 회사/부서 목표, 개인 목표/체크리스트 생성·수정은 전부 "이번 달 또는 지난달"만 허용 (`handlers/_lib/monthWindow.js`).
- 부서 목표 개수 제한은 팀·달·**파트**(`part`, 빈 문자열 포함) 조합으로 5개까지.
- **이 프로젝트는 자동화 테스트 프레임워크가 없다** — 기존 계획 문서(`docs/superpowers/plans/2026-08-03-goal-cascade-and-mypage.md`)와 동일한 관례를 따른다: 각 서버 파일 작성 후 `node --check <file>`로 문법만 검증하고, 실제 동작은 `node scripts/dev-server.js`(`.env.local`에 이미 `DATABASE_URL` 설정돼 있음)를 띄운 뒤 `curl`과 브라우저 미리보기로 확인한다.
- **스펙에 없던 결정 두 가지(이 계획에서 확정)**:
  1. `handlers/public-data.js`의 `members` 목록에 `team`/`position`을 추가로 노출한다 — 부서목표 탭의 "팀원별 현황"이 로그인 없이도 팀원 이름·직책을 보여줘야 하는데, 스펙에는 이 데이터 소스가 명시돼 있지 않았다. team/position은 급여·주소 같은 민감 정보가 아니라 기존 "민감 정보는 /api/all에만" 원칙에 어긋나지 않는다.
  2. "팀원별 현황"에서 각 팀원을 파트(인사/회계 등)로 묶을 때, 멤버 레코드 자체에는 파트 필드가 없으므로(스펙에서 의도적으로 만들지 않기로 함) **그 팀원의 이번 달 개인 목표가 연결된 부서 목표의 `part` 값**으로 그룹을 판별한다. 이번 달 개인 목표가 아직 없는 팀원은 "파트 미지정" 그룹에 넣는다.

---

## Task 1: SQL 마이그레이션 — `members.role`, `okrs.part`

**Files:**
- Create: `sql/006_role_and_part.sql`

**Interfaces:**
- Produces: `members.role` (text, NOT NULL, DEFAULT '팀원'), `okrs.part` (text, DEFAULT '')

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
ALTER TABLE members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT '팀원';
-- '관리자' | '부서장' | '팀원' 세 값만 앱 레벨에서 사용 (기존 컨벤션대로 DB CHECK 제약은 걸지 않음)

ALTER TABLE okrs ADD COLUMN IF NOT EXISTS part text DEFAULT '';
-- 레벨='조직'일 때만 사용. 빈 문자열 = 파트 구분 없는 팀
```

- [ ] **Step 2: 로컬 Neon DB에 적용**

Run: `node scripts/run-sql.js sql/006_role_and_part.sql`
Expected: `OK: executed sql/006_role_and_part.sql`

- [ ] **Step 3: 컬럼이 실제로 생겼는지, 기존 27명이 기본값으로 채워졌는지 확인**

Run:
```bash
node -e "
import('@neondatabase/serverless').then(async ({ Client }) => {
  const fs = await import('node:fs');
  for (const line of fs.readFileSync('.env.local','utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim();
  }
  const client = new Client(process.env.DATABASE_URL);
  await client.connect();
  const { rows } = await client.query(\"SELECT role, count(*) FROM members GROUP BY role\");
  console.log(rows);
  await client.end();
});
"
```
Expected: 한 줄 `{ role: '팀원', count: '27' }` (전원 기본값)

- [ ] **Step 4: 커밋**

```bash
git add sql/006_role_and_part.sql
git commit -m "feat: add members.role and okrs.part columns"
```

---

## Task 2: 월 편집 범위 공용 유틸

**Files:**
- Create: `handlers/_lib/monthWindow.js`

**Interfaces:**
- Produces: `currentMonthKey(): string`, `previousMonthKey(): string`, `isEditableMonth(month: string): boolean` — Task 4/5/6에서 그대로 import해서 쓴다.

- [ ] **Step 1: 파일 작성**

```js
/**
 * handlers/_lib/monthWindow.js
 *
 * 목표/체크리스트 생성·수정을 "이번 달 + 지난달"로만 제한하기 위한 공용
 * 월 계산 유틸. 월말이 주말과 겹쳐 그날 체크를 못 하는 경우를 대비해
 * 다음 달로 넘어간 뒤에도 지난달 몫을 정리할 여유를 준다
 * (docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md
 * "월 편집 정책" 참고). UTC 기준으로 계산한다 — 이 프로젝트의 다른 날짜
 * 처리(예: handlers/members/index.js의 기본 입사일)도 전부 UTC 기준이라
 * 그 컨벤션을 따른다.
 */
function pad2(n) { return String(n).padStart(2, '0'); }

export function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function previousMonthKey() {
  const d = new Date();
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
}

export function isEditableMonth(month) {
  return month === currentMonthKey() || month === previousMonthKey();
}
```

- [ ] **Step 2: 문법 검증 + 동작 확인**

Run: `node --check handlers/_lib/monthWindow.js`
Expected: no output (문법 OK)

Run:
```bash
node -e "
import('./handlers/_lib/monthWindow.js').then(m => {
  console.log('current:', m.currentMonthKey());
  console.log('previous:', m.previousMonthKey());
  console.log('editable(current)?', m.isEditableMonth(m.currentMonthKey()));
  console.log('editable(2020-01)?', m.isEditableMonth('2020-01'));
});
"
```
Expected: `editable(current)?` → `true`, `editable(2020-01)?` → `false`

- [ ] **Step 3: 커밋**

```bash
git add handlers/_lib/monthWindow.js
git commit -m "feat: add current/previous-month editable-window helper"
```

---

## Task 3: 구성원 `role` — 읽기/쓰기 배관

**Files:**
- Modify: `handlers/me.js`
- Modify: `handlers/members/index.js`
- Modify: `handlers/members/[id].js`
- Modify: `handlers/all.js` (약 line 34-68 `members_out` 매핑에 한 줄 추가)

**Interfaces:**
- Consumes: 없음 (DB 컬럼만 사용)
- Produces: `GET /api/me` 응답에 `role` 필드. `POST /api/members`가 `role` body 필드를 받음. `PATCH /api/members/:id`가 `role` body 필드를 받음. `GET /api/all` 응답의 각 member 객체에 `role` 필드.

- [ ] **Step 1: `handlers/me.js` 전체를 아래로 교체**

```js
/**
 * handlers/me.js
 *
 * GET -> 200 { id, name, team, role }  로그인한 본인 정보 (team/role은
 * "우리 팀 달성률" 계산과 목표 탭 역할별 화면 렌더링에 쓰이는, 본인만의
 * 정보라 공개 API(public-data)에는 안 내려가는 값들을 여기서만 노출한다).
 */
import { sql } from './_lib/db.js';
import { requireMemberAuth } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  try {
    const rows = await sql`SELECT id, name, team, role FROM members WHERE id = ${memberId}`;
    if (!rows.length) return res.status(401).json({ error: '로그인이 필요해요' });
    res.status(200).json({ id: rows[0].id, name: rows[0].name, team: rows[0].team || '', role: rows[0].role || '팀원' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '내 정보를 불러오지 못했어요' });
  }
}
```

- [ ] **Step 2: `handlers/members/index.js` 전체를 아래로 교체**

```js
import { sql } from '../_lib/db.js';
import { requireHrAuth } from '../_lib/hrAuth.js';

const ALLOWED_ROLES = ['관리자', '부서장', '팀원'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireHrAuth(req, res)) return;
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });
  const role = ALLOWED_ROLES.includes(b.role) ? b.role : '팀원';

  try {
    const [row] = await sql`
      INSERT INTO members (name, team, position, email, phone, hire_date, group_hire_date, hire_type, work_type_name, work_type_fixed, worked_hours, leave_left, deduction_basic, deduction_health_dependents, role)
      VALUES (${b.name}, ${b.team || ''}, ${b.position || ''}, ${b.email || ''}, ${b.phone || ''}, ${b.hireDate || new Date().toISOString().slice(0,10)}, ${b.groupHireDate || new Date().toISOString().slice(0,10)}, '정규직', '', true, '0시간', '0일', 0, 0, ${role})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create member' });
  }
}
```

- [ ] **Step 3: `handlers/members/[id].js`에 role 처리 추가**

`if (body.workType) { ... }` 블록 바로 앞(파일의 36번째 줄 부근, `if (!sets.length)` 이전)에 삽입:

```js
  const ALLOWED_ROLES = ['관리자', '부서장', '팀원'];
  if ('role' in body) {
    sets.push(`role = $${i++}`); values.push(ALLOWED_ROLES.includes(body.role) ? body.role : '팀원');
  }
```

- [ ] **Step 4: `handlers/all.js`의 `members_out` 매핑(약 34번째 줄)에 한 줄 추가**

`nickname: m.nickname || '',` 다음 줄에 추가:
```js
      role: m.role || '팀원',
```

- [ ] **Step 5: 문법 검증**

Run: `node --check handlers/me.js && node --check handlers/members/index.js && node --check "handlers/members/[id].js" && node --check handlers/all.js`
Expected: no output

- [ ] **Step 6: dev-server로 동작 확인**

Run: `node scripts/dev-server.js` (백그라운드로 띄운 채로 아래 진행)

```bash
# 1) HR 비밀번호로 구성원 하나를 관리자로 만들어보고
curl -s -X POST http://localhost:3000/api/members \
  -H 'Content-Type: application/json' -H 'X-HR-Password: '"$HR_PASSWORD" \
  -d '{"name":"테스트관리자","team":"경영지원팀","email":"test-admin@selfdiylab.com","role":"관리자"}'
# -> {"id":"..."} 가 나와야 함

# 2) 그 사람으로 로그인해서 /api/me가 role을 돌려주는지 확인
curl -s -c /tmp/cookies.txt -X POST http://localhost:3000/api/member-login \
  -H 'Content-Type: application/json' -d '{"email":"test-admin@selfdiylab.com"}'
curl -s -b /tmp/cookies.txt http://localhost:3000/api/me
# -> {"id":"...","name":"테스트관리자","team":"경영지원팀","role":"관리자"}
```
Expected: 위 주석대로 role이 정확히 반영되어 돌아옴. (`$HR_PASSWORD`는 `.env.local`의 값)

- [ ] **Step 7: 커밋**

```bash
git add handlers/me.js handlers/members/index.js "handlers/members/[id].js" handlers/all.js
git commit -m "feat: read/write members.role through me/members endpoints"
```

---

## Task 4: `handlers/okrs/index.js` — 역할 검사, 파트, 5개 제한, 월 제한

**Files:**
- Modify: `handlers/okrs/index.js`

**Interfaces:**
- Consumes: `isEditableMonth` from `handlers/_lib/monthWindow.js` (Task 2), `getSessionMemberId` from `handlers/_lib/memberSession.js`
- Produces: `POST /api/okrs` body는 이제 `part`(선택, 조직 레벨용)를 받는다. 회사=관리자, 조직=부서장+본인팀만 허용. 401/403/400 에러 메시지는 아래 코드 그대로.

- [ ] **Step 1: 파일 전체를 아래로 교체**

```js
/**
 * handlers/okrs/index.js
 *
 * POST { level:'회사', title, month } -> 201 { id }
 * POST { level:'조직', title, month, parent, owner, part } -> 201 { id }
 *
 * 개인(level:'개인') 목표는 여기서 만들지 않는다 — 로그인한 본인 명의로만
 * 만들어져야 하므로 /api/my-goals를 쓴다(handlers/my-goals/index.js).
 *
 * 2026-08-04: 지금까지 이 엔드포인트는 로그인 여부와 무관하게 누구나 호출할
 * 수 있었다. 목표 탭을 역할(관리자/부서장/팀원) 기반으로 재설계하면서 실제
 * 권한 검사를 추가한다 — 회사 목표는 role='관리자'만, 부서 목표는
 * role='부서장'이면서 그 팀 소속인 사람만 만들 수 있다
 * (docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md 참고).
 *
 * 부서(조직) 목표는 반드시 "같은 달"의 기업(회사) 목표를 상위로 선택해야
 * 하고, 같은 팀(owner)·같은 달(month)·같은 파트(part)에 5개를 넘게 만들 수
 * 없다. part는 한 팀 안에 기능이 나뉘는 경우(예: 인사회계팀의 인사/회계)를
 * 위한 자유 텍스트 태그로, 없으면 빈 문자열이다.
 *
 * 회사/부서 목표 모두 "이번 달 또는 지난달"만 만들 수 있다(isEditableMonth).
 */
import { sql } from '../_lib/db.js';
import { getSessionMemberId } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

// '2026-08' -> '2026-Q3'
function quarterFromMonth(month) {
  const [year, m] = month.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${year}-Q${q}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const memberId = getSessionMemberId(req);
  if (!memberId) return res.status(401).json({ error: '로그인이 필요해요' });
  const [me] = await sql`SELECT role, team FROM members WHERE id = ${memberId}`;
  if (!me) return res.status(401).json({ error: '로그인이 필요해요' });

  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
  if (b.level === '개인') return res.status(400).json({ error: '개인 목표는 /api/my-goals로 만들어주세요' });
  if (b.level !== '회사' && b.level !== '조직') return res.status(400).json({ error: 'level must be 회사 or 조직' });
  if (!b.month) return res.status(400).json({ error: '월을 선택해주세요' });
  if (!isEditableMonth(b.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 만들 수 있어요' });

  try {
    if (b.level === '조직') {
      if (me.role !== '부서장') return res.status(403).json({ error: '부서 목표는 부서장만 만들 수 있어요' });

      const owner = (b.owner || '-').trim() || '-';
      if (owner !== me.team) return res.status(403).json({ error: '본인 팀 목표만 만들 수 있어요' });

      if (!b.parent) return res.status(400).json({ error: '상위 기업 목표를 선택해주세요' });
      const [parent] = await sql`SELECT id, level, month FROM okrs WHERE id = ${b.parent}`;
      if (!parent || parent.level !== '회사') {
        return res.status(400).json({ error: '상위 목표는 기업 목표여야 해요' });
      }
      if (parent.month !== b.month) {
        return res.status(400).json({ error: '상위 기업 목표와 같은 달로 맞춰주세요' });
      }

      const part = (b.part || '').trim();
      const [{ count }] = await sql`
        SELECT count(*)::int AS count FROM okrs
        WHERE level = '조직' AND owner = ${owner} AND month = ${b.month} AND part = ${part}`;
      if (count >= 5) {
        return res.status(400).json({ error: `${owner}${part ? ' · ' + part : ''} 팀은 ${b.month}에 이미 목표가 5개 있어요` });
      }

      const [row] = await sql`
        INSERT INTO okrs (quarter, month, level, title, owner, parent_id, part, progress, unit, target)
        VALUES (${quarterFromMonth(b.month)}, ${b.month}, '조직', ${b.title.trim()}, ${owner}, ${b.parent}, ${part}, 0, '%', 100)
        RETURNING id`;
      return res.status(201).json({ id: row.id });
    }

    // 회사
    if (me.role !== '관리자') return res.status(403).json({ error: '회사 목표는 관리자만 만들 수 있어요' });
    const [row] = await sql`
      INSERT INTO okrs (quarter, month, level, title, owner, progress, unit, target)
      VALUES (${quarterFromMonth(b.month)}, ${b.month}, '회사', ${b.title.trim()}, '전사', 0, '%', 100)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OKR' });
  }
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --check handlers/okrs/index.js`
Expected: no output

- [ ] **Step 3: dev-server로 권한 시나리오 확인** (dev-server가 이미 떠 있어야 함)

```bash
# 로그인 안 한 상태로 회사 목표 생성 시도 -> 401
curl -s -X POST http://localhost:3000/api/okrs -H 'Content-Type: application/json' \
  -d '{"level":"회사","title":"테스트","month":"'$(date -u +%Y-%m)'"}'
# -> {"error":"로그인이 필요해요"}

# Task 3에서 만든 "테스트관리자"(role=관리자)로 로그인 후 회사 목표 생성 -> 201
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/okrs -H 'Content-Type: application/json' \
  -d '{"level":"회사","title":"테스트 회사목표","month":"'$(date -u +%Y-%m)'"}'
# -> {"id":"..."}

# 같은 관리자 계정으로 부서 목표 생성 시도 -> 403 (관리자는 부서 목표 못 만듦)
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/okrs -H 'Content-Type: application/json' \
  -d '{"level":"조직","title":"테스트 부서목표","month":"'$(date -u +%Y-%m)'","owner":"경영지원팀","parent":"<위에서 받은 회사목표 id>"}'
# -> {"error":"부서 목표는 부서장만 만들 수 있어요"}
```
Expected: 각 응답이 주석과 일치.

- [ ] **Step 4: 커밋**

```bash
git add handlers/okrs/index.js
git commit -m "feat: enforce role/team/part/month rules on company and dept goal creation"
```

---

## Task 5: `handlers/my-goals/index.js` — 본인 팀 검증 + 월 제한

**Files:**
- Modify: `handlers/my-goals/index.js`

**Interfaces:**
- Consumes: `isEditableMonth` (Task 2)
- Produces: `POST /api/my-goals`가 상위 부서 목표의 팀이 로그인한 사람의 팀과 다르면 403, 상위 목표 월이 편집 가능 범위 밖이면 400을 돌려준다.

- [ ] **Step 1: 파일 전체를 아래로 교체**

```js
/**
 * handlers/my-goals/index.js
 *
 * POST { parentId, title } -> 201 { id }
 *
 * 개인(레벨='개인') 목표 생성 전용 엔드포인트. /api/okrs는 이 레벨을
 * 거부한다 — 개인 목표는 반드시 로그인한 본인 명의로만 만들어져야 하므로
 * 세션에서 얻은 memberId를 그대로 소유자로 쓴다(요청 바디의 소유자는
 * 받지 않음). quarter/month는 상위(부서) 목표에서 그대로 상속한다.
 *
 * 2026-08-04: 상위 부서 목표가 로그인한 본인의 팀 소속인지 확인하는 검증을
 * 추가했다 — 이전에는 다른 팀의 부서 목표에도 개인 목표를 붙일 수 있었다.
 * 상위 부서 목표의 월이 이번 달/지난달이 아니면 거부한다.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { parentId, title } = req.body || {};
  if (!parentId) return res.status(400).json({ error: '연결할 부서 목표를 선택해주세요' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const [me] = await sql`SELECT team FROM members WHERE id = ${memberId}`;
    const [parent] = await sql`SELECT id, quarter, month, level, owner FROM okrs WHERE id = ${parentId}`;
    if (!parent || parent.level !== '조직') {
      return res.status(400).json({ error: '상위 목표는 부서 목표여야 해요' });
    }
    if (!me || parent.owner !== me.team) {
      return res.status(403).json({ error: '본인 팀의 부서 목표에만 연결할 수 있어요' });
    }
    if (!isEditableMonth(parent.month)) {
      return res.status(400).json({ error: '이번 달/지난달 부서 목표에만 연결할 수 있어요' });
    }

    const [row] = await sql`
      INSERT INTO okrs (quarter, month, level, title, owner, parent_id, member_id, progress, unit, target)
      VALUES (${parent.quarter}, ${parent.month}, '개인', ${title.trim()}, '-', ${parent.id}, ${memberId}, 0, '%', 100)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
}
```

- [ ] **Step 2: 문법 검증**

Run: `node --check handlers/my-goals/index.js`
Expected: no output

- [ ] **Step 3: dev-server로 확인**

```bash
# 다른 팀 소속 사람(윤혜민, 인사회계팀)이 방금 만든 "경영지원팀" 부서목표에 개인목표를 붙이려 하면 403이어야 함
curl -s -c /tmp/cookies-min.txt -X POST http://localhost:3000/api/member-login \
  -H 'Content-Type: application/json' -d '{"email":"min02@selfdiylab.com"}'
curl -s -b /tmp/cookies-min.txt -X POST http://localhost:3000/api/my-goals \
  -H 'Content-Type: application/json' -d '{"parentId":"<경영지원팀 부서목표 id>","title":"테스트"}'
# -> {"error":"본인 팀의 부서 목표에만 연결할 수 있어요"}
```
Expected: 403 + 위 메시지.

- [ ] **Step 4: 커밋**

```bash
git add handlers/my-goals/index.js
git commit -m "feat: restrict personal goal creation to own team's dept goals"
```

---

## Task 6: `handlers/okr-tasks/*` — 월 제한

**Files:**
- Modify: `handlers/okr-tasks/index.js`
- Modify: `handlers/okr-tasks/[id].js`

**Interfaces:**
- Consumes: `isEditableMonth` (Task 2)
- Produces: 체크리스트 생성/체크/삭제가 목표의 월이 편집 가능 범위 밖이면 400.

- [ ] **Step 1: `handlers/okr-tasks/index.js` 전체를 아래로 교체**

```js
/**
 * handlers/okr-tasks/index.js
 *
 * POST { okrId, title } -> 201 { id }
 *
 * 본인이 소유한 개인 목표(okrs.member_id = 세션 memberId)에만 할 일을
 * 추가할 수 있다. 2026-08-04: 그 목표의 월이 이번 달/지난달이 아니면 거부.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { okrId, title } = req.body || {};
  if (!okrId || !title || !title.trim()) return res.status(400).json({ error: 'okrId and title are required' });

  try {
    const [okr] = await sql`SELECT id, member_id, month FROM okrs WHERE id = ${okrId}`;
    if (!okr || okr.member_id !== memberId) {
      return res.status(403).json({ error: '본인 목표에만 할 일을 추가할 수 있어요' });
    }
    if (!isEditableMonth(okr.month)) {
      return res.status(400).json({ error: '이번 달/지난달 목표만 수정할 수 있어요' });
    }

    const [row] = await sql`INSERT INTO okr_tasks (okr_id, title) VALUES (${okrId}, ${title.trim()}) RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task' });
  }
}
```

- [ ] **Step 2: `handlers/okr-tasks/[id].js` 전체를 아래로 교체**

```js
/**
 * handlers/okr-tasks/[id].js
 *
 * PATCH { done } -> 200 { ok: true }   체크/해제
 * DELETE         -> 200 { ok: true }   삭제
 *
 * 두 메서드 모두 이 task가 속한 okrs.member_id가 세션 memberId와 같을 때만
 * 허용한다. 2026-08-04: 그 목표의 월이 이번 달/지난달이 아니면 거부한다.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

async function loadOwnedTask(id, memberId) {
  const [row] = await sql`
    SELECT t.id, o.month FROM okr_tasks t
    JOIN okrs o ON o.id = t.okr_id
    WHERE t.id = ${id} AND o.member_id = ${memberId}`;
  return row || null;
}

export default async function handler(req, res) {
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;
  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const { done } = req.body || {};
      if (typeof done !== 'boolean') return res.status(400).json({ error: 'done must be boolean' });
      const task = await loadOwnedTask(id, memberId);
      if (!task) return res.status(403).json({ error: '본인 할 일만 수정할 수 있어요' });
      if (!isEditableMonth(task.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 수정할 수 있어요' });
      await sql`UPDATE okr_tasks SET done = ${done} WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const task = await loadOwnedTask(id, memberId);
      if (!task) return res.status(403).json({ error: '본인 할 일만 삭제할 수 있어요' });
      if (!isEditableMonth(task.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 삭제할 수 있어요' });
      await sql`DELETE FROM okr_tasks WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update task' });
  }
}
```

- [ ] **Step 3: 문법 검증 + 커밋**

Run: `node --check handlers/okr-tasks/index.js && node --check "handlers/okr-tasks/[id].js"`
Expected: no output

```bash
git add handlers/okr-tasks/index.js "handlers/okr-tasks/[id].js"
git commit -m "feat: restrict checklist create/update/delete to editable months"
```

---

## Task 7: `handlers/public-data.js` — `part` + 팀원 team/position 노출

**Files:**
- Modify: `handlers/public-data.js`

**Interfaces:**
- Produces: `GET /api/public-data`의 `okrs[].part`, `members[].team`, `members[].position` 필드 추가.

- [ ] **Step 1: 파일 전체를 아래로 교체**

```js
/**
 * handlers/public-data.js
 *
 * GET -> { okrs, evals, calibration, oneonones }
 *
 * The company-wide 성과관리 dataset, deliberately UNAUTHENTICATED: every
 * employee can see 목표 / 평가 / 캘리브레이션 / 원온원. The shapes here are
 * identical to the corresponding four keys of handlers/all.js so the frontend
 * can use either source interchangeably.
 *
 * 2026-08-04: `members`에 team/position을 추가로 노출한다 — 목표 탭의
 * "부서 목표" 화면이 같은 팀 팀원의 이름·직책·개인 목표 진행률을 로그인
 * 없이도 보여줘야 하기 때문이다(역할 구분은 "화면을 다르게 보여주기" 위한
 * 것이지 데이터를 숨기기 위한 게 아니라는 게 이번 재설계의 전제 —
 * docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md
 * 참고). team/position은 급여·주소 같은 민감 정보가 아니라서 추가해도
 * 기존 "민감 정보는 /api/all에만" 원칙에 어긋나지 않는다. role/email/phone
 * 등 나머지 컬럼은 여전히 노출하지 않는다.
 *
 * Every other member column -- email, phone, address, contracts, salary,
 * 인사노트 etc. -- stays behind the password gate and is only reachable via
 * /api/all. Do not widen the SELECT below beyond id/name/team/position.
 */

import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [members, okrs, okrTasks, evals, calibrationCycles, calibrationOverrides, oneonones] = await Promise.all([
      sql`SELECT id, name, team, position FROM members ORDER BY name`,
      sql`SELECT * FROM okrs`,
      sql`SELECT * FROM okr_tasks`,
      sql`SELECT * FROM evals`,
      sql`SELECT * FROM calibration_cycles`,
      sql`SELECT * FROM calibration_overrides`,
      sql`SELECT * FROM oneonones ORDER BY date`
    ]);

    const memberNameById = Object.fromEntries(members.map(m => [m.id, m.name]));

    const okrs_out = okrs.map(o => ({
      id: o.id, quarter: o.quarter, month: o.month, level: o.level, title: o.title, owner: o.owner,
      parent: o.parent_id, member: o.member_id, part: o.part || '', progress: o.progress, unit: o.unit, target: o.target
    }));

    const okrTasks_out = okrTasks.map(t => ({ id: t.id, okrId: t.okr_id, title: t.title, done: t.done }));

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
      // id, name, team, position ONLY -- see the file header before widening.
      members: members.map(m => ({ id: m.id, name: m.name, team: m.team || '', position: m.position || '' })),
      okrs: okrs_out,
      okrTasks: okrTasks_out,
      evals: evals_out,
      calibration: calibration_out,
      oneonones: oneonones_out
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load public data' });
  }
}
```

- [ ] **Step 2: 문법 검증 + 확인 + 커밋**

Run: `node --check handlers/public-data.js`

```bash
curl -s http://localhost:3000/api/public-data | node -e "
let raw=''; process.stdin.on('data',d=>raw+=d).on('end',()=>{
  const d = JSON.parse(raw);
  console.log('member sample:', d.members[0]);
});
"
```
Expected: `member sample: { id: '...', name: '...', team: '...', position: '...' }` (email/phone 등은 없음)

```bash
git add handlers/public-data.js
git commit -m "feat: expose okrs.part and members team/position on public-data"
```

---

## Task 8: 구성원 등록/수정 화면에 역할 선택 추가

**Files:**
- Modify: `index.html` (`openMemberAddModal`/`saveMember` — 약 637-660번째 줄, `openEditBasicInfo`/`saveBasicInfo` — 약 769-806번째 줄)

**Interfaces:**
- Consumes: `apiPost('/members', ...)`, `apiPatch('/members/:id', ...)` (기존 함수 그대로)

- [ ] **Step 1: `openMemberAddModal`/`saveMember`를 아래로 교체**

```html
function openMemberAddModal(){
  showModal(`
    <h3>구성원 추가하기</h3>
    <div class="form-row">
      <div class="field"><label>이름</label><input id="f-mname2" placeholder="홍길동"></div>
      <div class="field"><label>이메일</label><input id="f-memail" placeholder="name@selfdiylab.com"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>소속 조직</label><input id="f-mteam" placeholder="예: 개발팀"></div>
      <div class="field"><label>직책</label><input id="f-mposition" placeholder="예: 매니저"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>휴대전화번호</label><input id="f-mphone" placeholder="010-0000-0000"></div>
      <div class="field"><label>목표 화면 권한</label>
        <select id="f-mrole"><option value="팀원" selected>팀원</option><option value="부서장">부서장</option><option value="관리자">관리자</option></select>
      </div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveMember()">추가</button></div>
  `);
}
async function saveMember(){
  const name = document.getElementById('f-mname2').value.trim();
  if(!name) return alert('이름을 입력해주세요');
  await apiPost('/members', {
    name, team:document.getElementById('f-mteam').value||'', position:document.getElementById('f-mposition').value||'',
    email:document.getElementById('f-memail').value||'', phone:document.getElementById('f-mphone').value||'',
    role:document.getElementById('f-mrole').value
  });
  await refreshDB(); closeModal(); renderMembers();
}
```

- [ ] **Step 2: `openEditBasicInfo`/`saveBasicInfo`를 아래로 교체**

```html
function openEditBasicInfo(){
  const m = getCurrentMember();
  showModal(`
    <h3>기본 정보 변경</h3>
    <div class="field"><label>본명</label><input id="f-b-name" value="${escapeHtml(m.name)}"></div>
    <div class="form-row">
      <div class="field"><label>이메일</label><input id="f-b-email" value="${escapeHtml(m.email||'')}"></div>
      <div class="field"><label>개인 이메일</label><input id="f-b-pemail" value="${escapeHtml(m.personalEmail||'')}"></div>
    </div>
    <div class="form-row3">
      <div class="field"><label>입사일</label><input id="f-b-hire" type="date" value="${dateOnly(m.hireDate)}"></div>
      <div class="field"><label>그룹 입사일</label><input id="f-b-ghire" type="date" value="${dateOnly(m.groupHireDate)}"></div>
      <div class="field"><label>입사 유형</label><input id="f-b-htype" value="${escapeHtml(m.hireType||'')}"></div>
    </div>
    <div class="modal-sub">보안을 위해 주민등록번호는 이 데모 앱에서는 입력받지 않아요.</div>
    <div class="form-row">
      <div class="field"><label>생일</label><input id="f-b-bday" type="date" value="${dateOnly(m.birthday)}"></div>
      <div class="field"><label>휴대전화번호</label><input id="f-b-phone" value="${escapeHtml(m.phone||'')}"></div>
    </div>
    <div class="field"><label>주소</label><input id="f-b-addr" value="${escapeHtml(m.address||'')}"></div>
    <div class="field"><label>목표 화면 권한</label>
      <select id="f-b-role">
        ${['팀원','부서장','관리자'].map(r=>`<option value="${r}" ${(m.role||'팀원')===r?'selected':''}>${r}</option>`).join('')}
      </select>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveBasicInfo()">저장</button></div>
  `);
}
async function saveBasicInfo(){
  const patch = {
    name: document.getElementById('f-b-name').value,
    email: document.getElementById('f-b-email').value,
    personalEmail: document.getElementById('f-b-pemail').value,
    hireDate: document.getElementById('f-b-hire').value,
    groupHireDate: document.getElementById('f-b-ghire').value,
    hireType: document.getElementById('f-b-htype').value,
    birthday: document.getElementById('f-b-bday').value,
    phone: document.getElementById('f-b-phone').value,
    address: document.getElementById('f-b-addr').value,
    role: document.getElementById('f-b-role').value
  };
  await apiPatch('/members/'+currentMemberId, patch);
  await refreshDB(); closeModal(); renderMemberProfile();
}
```

- [ ] **Step 3: 브라우저로 확인**

`node scripts/dev-server.js` 띄운 채로 `http://localhost:3000` 접속 → 인사 비밀번호로 👥구성원 진입 → "+ 구성원 추가하기"에서 역할 선택지가 보이는지, 기존 구성원 프로필 → 기본 정보 변경에서도 현재 역할이 selected로 표시되고 바꿀 수 있는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: add role selector to member add/edit forms"
```

---

## Task 9: 🎯목표 화면 뼈대 — 3서브탭 + 공용 헬퍼

**Files:**
- Modify: `index.html` (OKR view HTML — 342-348번째 줄, `me` 주석 — 501번째 줄, `renderAll` — 1576-1589번째 줄)

**Interfaces:**
- Produces: `switchOkrTab(tab)`, `thisMonthKey()`, `prevMonthKey()`, `progressBarStyle(pct)`, `progressTextColor(pct)`, `POSITION_RANK`, `positionRank(position)`, `memberLoginBoxHtml(promptText)`, `submitOkrLogin()` — Task 10/11/12가 이 함수들을 그대로 가져다 쓴다.
- Consumes: 기존 `monthKeyOf(new Date())`, `escapeHtml`, `apiPost`, `apiGet`

- [ ] **Step 1: `<div class="view" id="view-okr">` 블록(342-348번째 줄)을 아래로 교체**

```html
    <!-- OKR -->
    <div class="view" id="view-okr">
      <div class="page-head"><div><h1>목표</h1><p id="okr-page-desc">이번 달 목표를 관리해요</p></div></div>
      <div class="tabs">
        <button class="tab active" onclick="switchOkrTab('overview')" id="okrtab-overview">전체 현황</button>
        <button class="tab" onclick="switchOkrTab('dept')" id="okrtab-dept">부서 목표</button>
        <button class="tab" onclick="switchOkrTab('personal')" id="okrtab-personal">개인 목표</button>
      </div>
      <div id="okr-overview"><div id="okr-overview-body"></div></div>
      <div id="okr-dept" style="display:none;"><div id="okr-dept-body"></div></div>
      <div id="okr-personal" style="display:none;"><div id="okr-personal-body"></div></div>
    </div>
```

- [ ] **Step 2: 기존 `individualProgress`/`orgProgress`/`companyProgress` 바로 아래, `openOkrModal` 정의 앞(1062번째 줄 부근)에 공용 헬퍼 추가**

```js
/* ---------- 목표 탭 공용 헬퍼 (역할별 재설계, 2026-08-04) ---------- */
function shiftMonthKey(monthKey, delta){
  const [y,m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m-1+delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
function thisMonthKey(){ return monthKeyOf(new Date()); }
function prevMonthKey(){ return shiftMonthKey(thisMonthKey(), -1); }
function progressBarStyle(pct){
  if(pct>=70) return 'background:linear-gradient(90deg,var(--primary),#5FDBA0);';
  if(pct>=31) return 'background:linear-gradient(90deg,var(--amber),#F6B26B);';
  return 'background:linear-gradient(90deg,var(--red),#F08080);';
}
function progressTextColor(pct){
  if(pct>=70) return 'var(--primary-dark)';
  if(pct>=31) return '#B9660F';
  return 'var(--red)';
}
const POSITION_RANK = ['대표','부장','팀장','파트장','과장','대리','주임','사원'];
function positionRank(position){
  const i = POSITION_RANK.indexOf(position);
  return i===-1 ? POSITION_RANK.length : i;
}
function memberLoginBoxHtml(promptText){
  return `
    <div class="section">
      <div class="section-head"><h3>로그인</h3><div class="desc">${escapeHtml(promptText)} (인사팀에 등록된 이메일, 비밀번호 없음)</div></div>
      <div class="field"><label>이메일</label><input id="f-okr-login-email" placeholder="you@selfdiylab.com" onkeydown="if(event.key==='Enter')submitOkrLogin()"></div>
      <div id="okr-login-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
      <button class="btn primary" onclick="submitOkrLogin()">로그인</button>
    </div>`;
}
async function submitOkrLogin(){
  const input = document.getElementById('f-okr-login-email');
  const errBox = document.getElementById('okr-login-error');
  errBox.style.display='none';
  const email = input.value.trim();
  if(!email){ errBox.textContent='이메일을 입력해주세요'; errBox.style.display='block'; return; }
  try{
    await apiPost('/member-login', {email});
    me = await apiGet('/me');
  }catch(err){ errBox.textContent = err.message; errBox.style.display='block'; return; }
  renderOkrDept(); renderOkrPersonal(); renderMyPage();
}
function switchOkrTab(tab){
  ['overview','dept','personal'].forEach(t=>{
    document.getElementById('okr-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('okrtab-'+t).classList.toggle('active', t===tab);
  });
}
```

- [ ] **Step 3: 옛 `openOkrModal`/`onOkrLevelChange`/`refreshOkrParentOptions`/`saveOkr` 4개 함수(1062-1111번째 줄)를 통째로 삭제** — Task 10/11이 각각 `openCompanyGoalModal`/`saveCompanyGoal`, `openDeptGoalModal`/`saveDeptGoal`로 대체한다. 지금 단계에서는 지우기만 하고, 아직 대체 함수를 안 만들었으니 `renderOkr()`(옛 이름)를 부르는 곳이 없는지 다음 Step에서 같이 정리한다.

- [ ] **Step 4: `let me = null;` 위 주석(501번째 줄)을 업데이트**

```js
let me = null; // 마이페이지/목표탭 로그인 상태: {id, name, team, role} | null
```

- [ ] **Step 5: `renderAll()`(1576-1589번째 줄)에서 `renderOkr();`를 아래 세 줄로 교체**

```js
  renderOkrOverview();
  renderOkrDept();
  renderOkrPersonal();
```

(이 세 함수는 Task 10/11/12에서 정의한다 — 지금 시점엔 아직 없으므로 `ReferenceError`가 나는 게 정상이다. Task 12까지 끝나야 페이지가 다시 정상 로드된다. 이 사실을 다음 Task 진행자에게 알리기 위해 이 단계에서는 브라우저 확인을 건너뛰고 `node --check`로 문법만 확인한다.)

- [ ] **Step 6: 문법 확인 + 커밋**

Run: `node -e "require('node:fs').readFileSync('index.html','utf8')" ` (파일이 읽히는지만 확인 — HTML은 `node --check` 대상이 아니라 스크립트 블록은 Task 12 완료 후 브라우저에서 최종 검증한다)

```bash
git add index.html
git commit -m "wip: scaffold 3-subtab goal view, remove legacy single-modal OKR create flow"
```

---

## Task 10: 전체 현황 서브탭 + 회사 목표 생성(관리자)

**Files:**
- Modify: `index.html` (Task 9에서 삭제한 자리, 옛 `renderOkr` 정의 자리에 추가)

**Interfaces:**
- Consumes: `progressBarStyle`, `progressTextColor`, `thisMonthKey`, `companyProgress`, `orgProgress` (기존/Task 9)
- Produces: `renderOkrOverview()`, `openCompanyGoalModal()`, `saveCompanyGoal()`, `monthOptionsHtml()` — Task 11이 `monthOptionsHtml()`을 재사용한다.

- [ ] **Step 1: Task 9의 Step 3에서 지운 자리에 추가**

```js
function monthOptionsHtml(){
  const t = thisMonthKey(), p = prevMonthKey();
  return `<option value="${t}">${t} (이번 달)</option><option value="${p}">${p} (지난달)</option>`;
}
function openCompanyGoalModal(){
  showModal(`
    <h3>회사 목표 만들기</h3>
    <div class="field"><label>월</label><select id="f-cgoal-month">${monthOptionsHtml()}</select></div>
    <div class="field"><label>목표 제목</label><input id="f-cgoal-title" placeholder="예: 신뢰받는 채용 브랜드로 성장한다"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveCompanyGoal()">목표 생성</button></div>
  `);
}
async function saveCompanyGoal(){
  const month = document.getElementById('f-cgoal-month').value;
  const title = document.getElementById('f-cgoal-title').value.trim();
  if(!title) return alert('목표 제목을 입력해주세요');
  try{ await apiPost('/okrs', {level:'회사', title, month}); }catch(err){ return alert(err.message); }
  await refreshDB(); closeModal(); renderOkrOverview(); renderOkrDept();
}
function renderOkrOverview(){
  const el = document.getElementById('okr-overview-body');
  if(!el) return;
  const month = thisMonthKey();
  const companies = DB.okrs.filter(o=>o.level==='회사' && o.month===month);
  const orgs = DB.okrs.filter(o=>o.level==='조직' && o.month===month);
  const orgAvgs = orgs.map(orgProgress);
  const overallAvg = orgAvgs.length ? Math.round(orgAvgs.reduce((a,v)=>a+v,0)/orgAvgs.length) : 0;
  const teams = [...new Set(orgs.map(o=>o.owner))];

  el.innerHTML = `
    ${me && me.role==='관리자' ? `<div style="text-align:right;margin-bottom:12px;"><button class="btn primary sm" onclick="openCompanyGoalModal()">+ 회사 목표 추가</button></div>` : ''}
    <div class="section">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700;margin-bottom:6px;"><span>📊 이번 달(${month}) 전사 달성률</span><span style="color:${progressTextColor(overallAvg)}">${overallAvg}%</span></div>
      <div class="bar"><i style="width:${overallAvg}%;${progressBarStyle(overallAvg)}"></i></div>
    </div>
    <div class="section">
      <div class="section-head"><h3>기업 목표</h3></div>
      ${companies.map(c=>{
        const p = companyProgress(c);
        return `<div style="margin-bottom:16px;">
          <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;margin-bottom:6px;"><span>${escapeHtml(c.title)}</span><span style="color:${progressTextColor(p)}">${p}%</span></div>
          <div class="bar"><i style="width:${p}%;${progressBarStyle(p)}"></i></div>
        </div>`;
      }).join('') || '<div class="empty">등록된 기업 목표가 없어요</div>'}
    </div>
    <div class="section">
      <div class="section-head"><h3>부서 목표</h3></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
        ${teams.map(team=>{
          const teamGoals = orgs.filter(o=>o.owner===team);
          const avg = teamGoals.length ? Math.round(teamGoals.reduce((a,g)=>a+orgProgress(g),0)/teamGoals.length) : 0;
          return `<div style="border:1px solid var(--border);border-radius:12px;padding:14px 16px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:800;color:var(--sub);text-transform:uppercase;margin-bottom:6px;"><span>${escapeHtml(team)}</span><span style="color:${progressTextColor(avg)}">${avg}%</span></div>
            ${teamGoals.map(g=>`<div style="font-size:13px;margin-bottom:4px;">${escapeHtml(g.title)}</div>`).join('')}
            <div class="bar"><i style="width:${avg}%;${progressBarStyle(avg)}"></i></div>
          </div>`;
        }).join('') || '<div class="empty">등록된 부서 목표가 없어요</div>'}
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: 커밋(문법 확인만, 브라우저 검증은 Task 12 완료 후)**

```bash
git add index.html
git commit -m "wip: add overview subtab + company goal creation for admin role"
```

---

## Task 11: 부서 목표 서브탭 (부서장 생성 + 팀원별 현황 + 다른 팀)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `memberLoginBoxHtml`, `positionRank`, `progressBarStyle`, `progressTextColor`, `initials` (기존)
- Produces: `renderOkrDept()`, `openDeptGoalModal()`, `saveDeptGoal()`

- [ ] **Step 1: Task 10에서 추가한 코드 바로 아래에 추가**

```js
function openDeptGoalModal(){
  showModal(`
    <h3>${escapeHtml(me.team)} 목표 만들기</h3>
    <div class="field"><label>월</label><select id="f-dept-month">${monthOptionsHtml()}</select></div>
    <div class="field"><label>파트 (선택)</label><input id="f-dept-part" placeholder="예: 인사, 회계 — 한 팀 안에서 안 나누면 비워두세요"></div>
    <div class="field"><label>목표 제목</label><input id="f-dept-title" placeholder="예: 전 직원 월간 목표 등록률 100%"></div>
    <div class="modal-sub">파트별로 한 달에 최대 5개까지 만들 수 있어요. 상위 기업 목표는 고른 월의 회사 목표로 자동 연결돼요</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveDeptGoal()">목표 생성</button></div>
  `);
}
async function saveDeptGoal(){
  const month = document.getElementById('f-dept-month').value;
  const title = document.getElementById('f-dept-title').value.trim();
  const part = document.getElementById('f-dept-part').value.trim();
  if(!title) return alert('목표 제목을 입력해주세요');
  const company = DB.okrs.find(o=>o.level==='회사' && o.month===month);
  if(!company) return alert(month + ' 기업 목표가 아직 없어요. 관리자에게 등록을 요청해주세요');
  try{ await apiPost('/okrs', {level:'조직', title, month, parent:company.id, owner:me.team, part}); }
  catch(err){ return alert(err.message); }
  await refreshDB(); closeModal(); renderOkrDept(); renderOkrOverview();
}
function renderOkrDept(){
  const el = document.getElementById('okr-dept-body');
  if(!el) return;
  if(!me){ el.innerHTML = memberLoginBoxHtml('내 팀 목표 화면을 보려면 로그인해주세요'); return; }

  const month = thisMonthKey();
  const myTeam = me.team;
  const teamOrgs = DB.okrs.filter(o=>o.level==='조직' && o.owner===myTeam && o.month===month);
  const parts = [...new Set(teamOrgs.map(o=>o.part||''))];
  const canCreate = me.role === '부서장';

  const banners = (parts.length ? parts : ['']).map(part=>{
    const goals = teamOrgs.filter(o=>(o.part||'')===part);
    return `
      <div class="section" style="margin-bottom:10px;">
        <div style="font-size:11.5px;font-weight:800;color:var(--primary-dark);text-transform:uppercase;margin-bottom:8px;">${escapeHtml(myTeam)}${part?` <span class="badge blue">${escapeHtml(part)}</span>`:''}</div>
        ${goals.map(g=>{
          const p = orgProgress(g);
          return `<div style="margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;"><span>${escapeHtml(g.title)}</span><span style="color:${progressTextColor(p)}">${p}%</span></div>
            <div class="bar"><i style="width:${p}%;${progressBarStyle(p)}"></i></div>
          </div>`;
        }).join('') || '<div class="empty">이번 달 목표가 없어요</div>'}
      </div>`;
  }).join('');

  const createForm = canCreate ? `
    <div class="section">
      <div class="section-head"><h3>새 팀 목표 만들기</h3></div>
      <button class="btn primary sm" onclick="openDeptGoalModal()">+ 목표 추가</button>
    </div>` : '';

  function memberPartKey(m){
    const g = DB.okrs.find(o=>o.level==='개인' && o.member===m.id && o.month===month);
    if(!g) return null;
    const parent = DB.okrs.find(o=>o.id===g.parent);
    return parent ? (parent.part||'') : null;
  }
  const teammates = DB.roster.filter(m=>m.team===myTeam);
  const groups = {};
  teammates.forEach(m=>{
    const key = parts.length ? (memberPartKey(m) ?? '__unassigned__') : '';
    (groups[key] = groups[key] || []).push(m);
  });
  Object.values(groups).forEach(list => list.sort((a,b)=>positionRank(a.position)-positionRank(b.position)));

  const teammatesHtml = Object.keys(groups).sort((a,b)=>{
    if(a==='__unassigned__') return 1; if(b==='__unassigned__') return -1; return a.localeCompare(b);
  }).map(key=>{
    const heading = key==='__unassigned__' ? '파트 미지정' : (key || myTeam);
    const rows = groups[key].map(m=>{
      const g = DB.okrs.find(o=>o.level==='개인' && o.member===m.id && o.month===month);
      const p = g ? individualProgress(g) : 0;
      return `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid var(--border);">
          <div class="avatar-circle" style="width:32px;height:32px;font-size:12px;">${initials(m.name)}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;">${escapeHtml(m.name)} · ${escapeHtml(m.position||'')}${m.id===me.id?' (나)':''}</div>
            <div style="font-size:12px;color:var(--sub);">${g ? escapeHtml(g.title) : '이번 달 개인 목표 없음'}</div>
          </div>
          <div style="width:100px;">
            <div style="text-align:right;font-size:11.5px;color:${progressTextColor(p)};margin-bottom:4px;">${p}%</div>
            <div class="bar"><i style="width:${p}%;${progressBarStyle(p)}"></i></div>
          </div>
        </div>`;
    }).join('');
    return `<div style="font-size:12px;font-weight:800;color:var(--sub);margin:14px 0 4px;text-transform:uppercase;">${escapeHtml(heading)}</div>${rows}`;
  }).join('') || '<div class="empty">같은 팀 구성원이 없어요</div>';

  const otherTeams = [...new Set(DB.okrs.filter(o=>o.level==='조직' && o.owner!==myTeam && o.month===month).map(o=>o.owner))];
  const otherHtml = otherTeams.map(team=>{
    const goals = DB.okrs.filter(o=>o.level==='조직' && o.owner===team && o.month===month);
    const avg = goals.length ? Math.round(goals.reduce((a,g)=>a+orgProgress(g),0)/goals.length) : 0;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">
      <span style="font-size:12.5px;font-weight:700;">${escapeHtml(team)}</span>
      <div class="bar" style="flex:1;margin:0 10px;"><i style="width:${avg}%;${progressBarStyle(avg)}"></i></div>
      <span style="font-size:12.5px;font-weight:800;color:${progressTextColor(avg)};width:32px;text-align:right;">${avg}%</span>
    </div>`;
  }).join('') || '<div class="empty">다른 팀 목표가 없어요</div>';

  el.innerHTML = `
    ${banners}
    ${createForm}
    <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;align-items:start;margin-top:20px;">
      <div><div class="section-head"><h3>👥 ${escapeHtml(myTeam)} 팀원별 현황</h3></div>${teammatesHtml}</div>
      <div><div class="section-head"><h3>다른 팀</h3></div>${otherHtml}</div>
    </div>`;
}
```

- [ ] **Step 2: 커밋(문법 확인만)**

```bash
git add index.html
git commit -m "wip: add dept goal subtab with teammate roster and other-team mini view"
```

---

## Task 12: 개인 목표 서브탭 + 마이페이지 축소

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `memberLoginBoxHtml`, `thisMonthKey`, `prevMonthKey`, `individualProgress` (기존/Task 9-11)
- Produces: `renderOkrPersonal()`, `savePersonalGoal()`, `addPersonalTask()`. 기존 `toggleMyTask`/`deleteMyTask`를 재활용(호출부만 변경).

- [ ] **Step 1: Task 11 아래에 추가**

```js
function renderOkrPersonal(){
  const el = document.getElementById('okr-personal-body');
  if(!el) return;
  if(!me){ el.innerHTML = memberLoginBoxHtml('개인 목표를 만들려면 로그인해주세요'); return; }

  const month = thisMonthKey(), prevMonth = prevMonthKey();
  const candidateOrgs = DB.okrs.filter(o=>o.level==='조직' && o.owner===me.team && (o.month===month || o.month===prevMonth));
  const myGoals = DB.okrs.filter(o=>o.level==='개인' && o.member===me.id && (o.month===month || o.month===prevMonth));

  el.innerHTML = `
    <div class="section">
      <div class="section-head"><h3>새 개인 목표 만들기</h3></div>
      <div class="field"><label>연결할 부서 목표</label>
        <select id="f-pgoal-parent">${candidateOrgs.map(o=>`<option value="${o.id}">${escapeHtml(o.title)}${o.part?` (${escapeHtml(o.part)})`:''} · ${escapeHtml(o.month)}</option>`).join('') || '<option value="">이번 달/지난달 등록된 팀 목표가 없어요</option>'}</select>
      </div>
      <div class="field"><label>목표 제목</label><input id="f-pgoal-title" placeholder="예: 우리 팀 목표 등록 100% 만들기"></div>
      <button class="btn primary" onclick="savePersonalGoal()">+ 목표 추가</button>
    </div>
    <div class="section">
      <div class="section-head"><h3>내 개인 목표</h3></div>
      ${myGoals.map(g=>{
        const org = DB.okrs.find(o=>o.id===g.parent);
        const p = individualProgress(g);
        const tasks = DB.okrTasks.filter(t=>t.okrId===g.id);
        return `
        <div style="margin-bottom:18px;border-bottom:1px solid var(--border);padding-bottom:14px;">
          <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:800;margin-bottom:4px;">
            <span>${escapeHtml(g.title)}</span><span style="color:${progressTextColor(p)}">${p}%</span>
          </div>
          <div style="font-size:11.5px;color:var(--sub);margin-bottom:6px;">↳ ${escapeHtml(me.team)}${org&&org.part?` (${escapeHtml(org.part)})`:''}${org?` · ${escapeHtml(org.title)}`:''}</div>
          <div class="bar" style="margin-bottom:8px;"><i style="width:${p}%;${progressBarStyle(p)}"></i></div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
            ${tasks.map(t=>`
              <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
                <input type="checkbox" ${t.done?'checked':''} onchange="toggleMyTask('${t.id}', this.checked)">
                <span style="flex:1;${t.done?'text-decoration:line-through;color:var(--sub);':''}">${escapeHtml(t.title)}</span>
                <button class="btn ghost sm" onclick="deleteMyTask('${t.id}')">삭제</button>
              </label>`).join('') || '<div class="empty">할 일이 없어요</div>'}
          </div>
          <div style="display:flex;gap:8px;">
            <input id="new-ptask-${g.id}" placeholder="할 일 추가" style="flex:1;border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:12.5px;" onkeydown="if(event.key==='Enter')addPersonalTask('${g.id}')">
            <button class="btn sm" onclick="addPersonalTask('${g.id}')">추가</button>
          </div>
        </div>`;
      }).join('') || '<div class="empty">이번 달 목표가 없어요. 위에서 추가해보세요</div>'}
    </div>`;
}
async function savePersonalGoal(){
  const parentId = document.getElementById('f-pgoal-parent').value;
  const title = document.getElementById('f-pgoal-title').value.trim();
  if(!parentId) return alert('연결할 팀 목표가 없어요');
  if(!title) return alert('목표 제목을 입력해주세요');
  try{ await apiPost('/my-goals', {parentId, title}); }catch(err){ return alert(err.message); }
  await refreshDB(); renderOkrPersonal(); renderOkrDept(); renderOkrOverview();
}
async function addPersonalTask(okrId){
  const input = document.getElementById('new-ptask-'+okrId);
  const title = input.value.trim(); if(!title) return;
  try{ await apiPost('/okr-tasks', {okrId, title}); }catch(err){ return alert(err.message); }
  await refreshDB(); renderOkrPersonal(); renderOkrDept();
}
```

- [ ] **Step 2: 옛 `openMyGoalModal`/`saveMyGoal`/`addMyTask` 3개 함수(약 1527-1554번째 줄)를 삭제** — `renderOkrPersonal`/`savePersonalGoal`/`addPersonalTask`로 대체됐다.

- [ ] **Step 3: `toggleMyTask`/`deleteMyTask`(약 1555-1562번째 줄)를 아래로 교체** (마이페이지 대신 목표탭을 새로고침하도록)

```js
async function toggleMyTask(id, done){
  try{ await apiPatch('/okr-tasks/'+id, {done}); }catch(err){ alert(err.message); }
  await refreshDB(); renderOkrPersonal(); renderOkrDept();
}
async function deleteMyTask(id){
  try{ await apiDelete('/okr-tasks/'+id); }catch(err){ alert(err.message); }
  await refreshDB(); renderOkrPersonal(); renderOkrDept();
}
```

- [ ] **Step 4: 마이페이지 HTML(429-437번째 줄, `mypage-kpis`와 "이번 달 내 목표" 섹션)을 삭제**

`<div class="grid4" id="mypage-kpis"></div>` 줄부터, "내 목표" `<div class="section">...+ 목표 추가...`</div>` 블록 전체(437번째 줄 `</div>`까지)를 지운다. 삭제 후 `view-mypage`는 로그인 박스 → 인사말 헤더 → 내 평가 기록 → 내 원온원 기록 순서만 남는다.

- [ ] **Step 5: `renderMyPage()`(1459번째 줄)에서 goal 관련 계산/렌더링 제거**

`thisMonth`/`myGoals`/`myAvg`/`teamOrgsThisMonth`/`teamAvg`/`companyIds`/`companyProgresses`/`companyAvg` 계산 블록과 `mypage-kpis`/`mypage-goals` 렌더링(1466-1511번째 줄)을 전부 지우고, 함수를 아래로 교체:

```js
function renderMyPage(){
  const loginBox = document.getElementById('mypage-login');
  const homeBox = document.getElementById('mypage-home');
  if(!me){ loginBox.style.display=''; homeBox.style.display='none'; return; }
  loginBox.style.display='none'; homeBox.style.display='';
  document.getElementById('mypage-hello').textContent = `${me.name}님, 안녕하세요`;

  const myEvals = DB.evals.filter(e=>e.employee===me.id);
  document.getElementById('mypage-evals').innerHTML = myEvals.map(e=>{
    const computed = gradeFor(e.performance, competency(e));
    const final = (DB.calibration[e.quarter] && DB.calibration[e.quarter].overrides[e.id]?.grade) || computed;
    return `<div class="ai-card">
      <div class="head"><b>${escapeHtml(e.quarter)} · ${final}등급</b></div>
      <div class="subscores"><span>공동역량 ${e.common}</span><span>리드역량 ${e.lead}</span><span>직무역량 ${e.job}</span><span>성과 ${e.performance}</span><span>커스텀 ${e.custom}</span></div>
      <p>강점: ${escapeHtml(e.strength)}</p><p>개선점: ${escapeHtml(e.improve)}</p>
    </div>`;
  }).join('') || '<div class="empty">등록된 평가가 없어요</div>';

  const myOneOnOnes = DB.oneonones.filter(o=>o.employee===me.id).map(o=>({sort:o.date, date:dayKeyOf(o.date), text:escapeHtml(o.note)}));
  renderTimelineInto('mypage-oneonones', myOneOnOnes, '아직 원온원 기록이 없어요');
}
```

- [ ] **Step 6: 로그인 함수 `submitMyLogin`/`submitMyLogout`(1439-1457번째 줄)이 목표탭도 같이 새로고침하도록 수정**

```js
async function submitMyLogin(){
  const input = document.getElementById('f-my-email');
  const errBox = document.getElementById('mypage-login-error');
  errBox.style.display = 'none';
  const email = input.value.trim();
  if(!email){ errBox.textContent = '이메일을 입력해주세요'; errBox.style.display = 'block'; return; }

  try{
    await apiPost('/member-login', {email});
    me = await apiGet('/me');
    renderMyPage(); renderOkrDept(); renderOkrPersonal();
  }catch(err){
    errBox.textContent = err.message; errBox.style.display = 'block';
  }
}
async function submitMyLogout(){
  await apiPost('/member-logout', {});
  me = null;
  renderMyPage(); renderOkrDept(); renderOkrPersonal();
}
```

- [ ] **Step 7: 브라우저로 전체 확인** (Task 9-12를 전부 마친 뒤 처음으로 하는 실제 렌더링 확인)

`node scripts/dev-server.js` 띄운 채 `http://localhost:3000` 접속:
1. 콘솔에 JS 에러가 없는지 확인 (`switchOkrTab`/`renderOkrOverview` 등 `ReferenceError`가 있으면 Task 9-12 중 빠뜨린 부분이 있다는 뜻)
2. 🎯목표 → 전체현황에 팀 카드들이 실제 제목과 함께 보이는지
3. 부서목표 탭 → 로그인 전엔 로그인 박스, `min02@selfdiylab.com`(윤혜민, 인사회계팀 팀장)으로 로그인 후 팀원별 현황이 보이는지
4. 개인목표 탭 → 목표 만들기 + 체크리스트 체크가 동작하는지
5. 마이페이지 → 목표 관련 UI가 없고 평가/원온원만 보이는지

- [ ] **Step 8: 커밋**

```bash
git add index.html
git commit -m "feat: move personal goal management into goal tab, trim mypage to eval/oneonone"
```

---

## Task 13 (코드 아님 — 수동 데이터 작업): 실제 구성원 역할 지정 + 배포

이 태스크는 구현이 아니라 **인사팀장(사용자)이 직접 해야 하는 작업**이다. 에이전트는 이 단계를 대신 실행하지 말고, 구현이 끝나면 사용자에게 아래를 안내한다.

- [ ] 27명 실제 구성원은 전부 `role='팀원'` 기본값이다. 👥구성원 화면에서 최소한 다음을 지정해야 목표 탭이 의미가 있다:
  - **관리자** 최소 1명 (예: 대표 김영우, 또는 인사팀장 본인)
  - 각 팀의 **부서장** 최소 1명 (예: CX팀 정애진 또는 강소현, 콘텐츠팀 조아라, 인사회계팀 윤혜민, 기획팀 이지혜, SCM팀 김지현, 영업팀 윤효선 — 실제 결정은 사용자 몫)
- [ ] 모든 Task의 로컬 검증(dev-server + curl/브라우저)이 끝나고 사용자가 실제로 화면을 확인한 뒤에만 `git push`로 `master`에 반영 — 이 프로젝트는 master push = Vercel 자동 배포이므로, 사용자의 명시적 승인 없이 push하지 않는다.
- [ ] 배포 후 실제 배포 사이트(https://selfdiylab-hr.vercel.app)에서 다시 한번 위 Step 7과 동일한 체크리스트로 확인한다.
