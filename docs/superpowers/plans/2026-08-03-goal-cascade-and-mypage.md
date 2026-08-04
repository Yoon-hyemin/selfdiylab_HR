# 목표 계층(기업→부서→개인) 달성률 + 마이페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **수정 이력(2026-08-03, 구현 완료 후)**: 이 계획 문서 본문은 "기업 목표=분기, 부서/개인=월"을 전제로 작성됐지만, 실제 구현 중 사용자 피드백에 따라 **기업 목표도 부서와 동일하게 매달 세우는 것**으로 바뀌었다(회사 목표에 분기 대신 월 필드 사용, 부서 목표는 같은 달의 회사 목표만 상위로 선택 가능, 달성률은 세 레벨 모두 "바로 아래 자식의 평균"으로 통일). 최신 사양은 `docs/superpowers/specs/2026-08-03-goal-cascade-and-mypage-design.md`와 커밋 `18f0ac7`/`4184d0a`를 참고할 것 — 아래 Task 본문의 "분기"/`quarter` 관련 서술은 그 기준으로 갱신해서 읽는다.

**Goal:** 기업(분기)→부서(월별, 팀당 월 3개)→개인(월별, 체크리스트) 3단계 목표 구조를 만들어, 개인이 할 일을 체크하면 개인→부서→기업 달성률이 자동 집계되고, 성과 대시보드에 기업/부서 달성률이 표시되며, 이메일만으로 로그인하는 "마이페이지"에서 본인의 목표·평가·원온원을 볼 수 있게 한다.

**Architecture:** 기존 패턴(정적 `index.html` + Vercel 서버리스 `/api/*` + Neon Postgres, 클라이언트가 전체 데이터를 한 번에 받아 렌더링/집계) 그대로 확장. 달성률은 DB에 저장하지 않고 매 렌더마다 클라이언트에서 계산. 개인 로그인은 비밀번호 없이 이메일 매칭 + HMAC 서명 쿠키 세션.

**Tech Stack:** Vanilla JS(프론트), Vercel Node 서버리스 함수(`handlers/*.js`), Neon Postgres(`@neondatabase/serverless`), 신규 의존성 없음(Node 내장 `crypto`만 사용).

## Global Constraints

- 새 의존성(npm 패키지) 추가 금지 — Node 내장 `crypto`로 세션 서명 구현
- `progress`/`unit`/`target` 컬럼은 삭제하지 않되, 새 화면에서는 읽지 않고 항상 계산값 사용
- 개인 목표(레벨='개인')는 `/api/okrs`로 생성 불가 — 반드시 `/api/my-goals` 사용 (본인 세션 필요)
- 부서 목표(레벨='조직')는 같은 팀(owner)·같은 달(month)에 3개 초과 생성 불가 (서버에서 카운트 검증)
- 개인 목표/체크리스트 쓰기 API는 세션의 memberId를 신뢰하고, 요청 바디의 member id는 신뢰하지 않음(본인 것만 수정 가능)
- 이 프로젝트는 자동화 테스트 프레임워크가 없음 — 각 핸들러 작성 후 `node --check <file>`로 문법만 검증하고, 실제 동작 확인은 로컬 dev-server(`node scripts/dev-server.js`, `.env.local` 필요)로 사용자가 최종 확인

---

## Task 1: SQL 마이그레이션 — okrs 컬럼 추가 + okr_tasks 테이블

**Files:**
- Create: `sql/003_okr_hierarchy.sql`

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS month text;
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS okr_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  okr_id uuid NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: 문법 확인**

Run: `node --check sql/003_okr_hierarchy.sql` 는 SQL이라 통하지 않음 — 대신 파일 내용을 육안으로 재확인 (컬럼명 오타, 세미콜론 여부)

- [ ] **Step 3: 커밋**

```bash
git add sql/003_okr_hierarchy.sql
git commit -m "feat: add month/member_id to okrs, add okr_tasks table"
```

- [ ] **Step 4 (사용자 실행 필요 — DB 접속정보 없이는 대행 불가):** `.env.local`에 `DATABASE_URL`이 설정된 환경에서 `node scripts/run-sql.js sql/003_okr_hierarchy.sql` 실행

---

## Task 2: 개인 로그인 세션 헬퍼

**Files:**
- Create: `handlers/_lib/memberSession.js`

**Interfaces:**
- Produces: `createSessionCookie(memberId): string`, `clearSessionCookie(): string`, `getSessionMemberId(req): string|null`, `requireMemberAuth(req, res): string|null` (401을 res에 써버리고 null 반환하는 패턴은 기존 `requireHrAuth`와 동일)

- [ ] **Step 1: 파일 작성**

```js
/**
 * handlers/_lib/memberSession.js
 *
 * 개인(구성원) 로그인 세션. 비밀번호 없이 이메일만으로 로그인하므로(POST
 * /api/member-login), 여기서 발급하는 쿠키는 "이 요청이 로그인 시점에 그
 * 이메일로 확인된 구성원의 것"이라는 것만 보장한다 — HR_PASSWORD 같은
 * 비밀 검증이 아니라, 위조 방지를 위한 서명(HMAC)이다.
 *
 * 새 의존성을 추가하지 않기 위해 JWT 라이브러리 대신 Node 내장 crypto로
 * "memberId.만료시각.서명" 형태의 토큰을 직접 만든다.
 */
import crypto from 'node:crypto';

const COOKIE_NAME = 'member_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30일

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createSessionCookie(memberId) {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${memberId}.${expires}`;
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

export function getSessionMemberId(req) {
  const token = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [memberId, expiresStr, sig] = parts;

  let expected;
  try {
    expected = sign(`${memberId}.${expiresStr}`);
  } catch {
    return null; // SESSION_SECRET not configured
  }
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  if (Date.now() > Number(expiresStr)) return null;
  return memberId;
}

export function requireMemberAuth(req, res) {
  const memberId = getSessionMemberId(req);
  if (!memberId) {
    res.status(401).json({ error: '로그인이 필요해요' });
    return null;
  }
  return memberId;
}
```

- [ ] **Step 2: 문법 확인**

Run: `node --check "handlers/_lib/memberSession.js"`
Expected: 아무 출력 없이 종료(문법 오류 없음)

- [ ] **Step 3: 커밋**

```bash
git add handlers/_lib/memberSession.js
git commit -m "feat: add HMAC-signed member session helper"
```

---

## Task 3: 로그인/로그아웃/내 정보 API + dev-server 쿠키 지원

**Files:**
- Create: `handlers/member-login.js`, `handlers/member-logout.js`, `handlers/me.js`
- Modify: `scripts/dev-server.js` (fakeRes에 `setHeader` 추가 — 없으면 로컬 dev-server에서 로그인 시 크래시)
- Modify: `api/[...path].js` (라우트 3개 등록)
- Modify: `.env.local.example` (SESSION_SECRET 추가)

**Interfaces:**
- Consumes: `createSessionCookie`, `clearSessionCookie`, `requireMemberAuth` from Task 2
- Produces: `POST /api/member-login {email} -> 200 {ok:true, member:{id,name}}` / `401 {error}`; `POST /api/member-logout -> 200 {ok:true}`; `GET /api/me -> 200 {id,name,team}` / `401 {error}`

- [ ] **Step 1: `handlers/member-login.js` 작성**

```js
/**
 * handlers/member-login.js
 *
 * POST { email } -> 200 { ok: true, member: {id, name} } + Set-Cookie
 *               -> 401 { error }  이메일이 등록되어 있지 않으면
 *
 * 비밀번호 없음 — 인사팀이 구성원 등록/수정 화면에서 미리 넣어둔 email과
 * 대소문자 무시 일치하면 로그인 성공으로 간주한다.
 */
import { sql } from './_lib/db.js';
import { createSessionCookie } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = (req.body && req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요' });

  try {
    const rows = await sql`SELECT id, name FROM members WHERE lower(email) = lower(${email}) LIMIT 1`;
    if (!rows.length) return res.status(401).json({ error: '등록된 이메일이 아니에요. 인사팀에 문의해주세요' });

    res.setHeader('Set-Cookie', createSessionCookie(rows[0].id));
    res.status(200).json({ ok: true, member: { id: rows[0].id, name: rows[0].name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '로그인에 실패했어요' });
  }
}
```

- [ ] **Step 2: `handlers/member-logout.js` 작성**

```js
import { clearSessionCookie } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(200).json({ ok: true });
}
```

- [ ] **Step 3: `handlers/me.js` 작성**

```js
/**
 * handlers/me.js
 *
 * GET -> 200 { id, name, team }  로그인한 본인 정보 (team은 "우리 팀 달성률"
 * 계산에 쓰이는 본인만의 정보라 공개 API(public-data)에는 안 내려가는
 * team을 여기서만 노출한다).
 */
import { sql } from './_lib/db.js';
import { requireMemberAuth } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  try {
    const rows = await sql`SELECT id, name, team FROM members WHERE id = ${memberId}`;
    if (!rows.length) return res.status(401).json({ error: '로그인이 필요해요' });
    res.status(200).json({ id: rows[0].id, name: rows[0].name, team: rows[0].team || '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '내 정보를 불러오지 못했어요' });
  }
}
```

- [ ] **Step 4: `scripts/dev-server.js`의 `fakeRes`에 `setHeader` 지원 추가**

`fakeRes` 정의부(약 179-192줄)를 아래로 교체 — 지금은 `status()/json()/end()`만 있어서 `res.setHeader(...)`를 호출하는 순간 로컬 dev-server가 그대로 크래시한다:

```js
  const fakeRes = {
    _status: 200,
    _headers: {},
    status(code) {
      this._status = code;
      return this;
    },
    setHeader(name, value) {
      this._headers[name] = value;
      return this;
    },
    json(obj) {
      res.writeHead(this._status, { 'Content-Type': 'application/json', ...this._headers });
      res.end(JSON.stringify(obj));
    },
    end() {
      res.writeHead(this._status, this._headers);
      res.end();
    }
  };
```

- [ ] **Step 5: `api/[...path].js`에 라우트 등록**

import 블록에 추가:
```js
import memberLoginHandler from '../handlers/member-login.js';
import memberLogoutHandler from '../handlers/member-logout.js';
import meHandler from '../handlers/me.js';
```
`ROUTES` 배열에 추가 (`{ pattern: ['hr-auth'], handler: hrAuthHandler },` 다음 줄):
```js
  { pattern: ['member-login'], handler: memberLoginHandler },
  { pattern: ['member-logout'], handler: memberLogoutHandler },
  { pattern: ['me'], handler: meHandler },
```

- [ ] **Step 6: `.env.local.example`에 SESSION_SECRET 추가**

파일 끝에 추가:
```
# 개인 로그인(이메일) 세션 쿠키 서명용 비밀키. 아무 임의의 긴 문자열이면 됨
# (openssl rand -hex 32 등으로 생성). 미설정 시 로그인 자체가 실패한다.
SESSION_SECRET=choose-a-random-string
```

- [ ] **Step 7: 문법 확인**

Run: `node --check handlers/member-login.js && node --check handlers/member-logout.js && node --check handlers/me.js && node --check scripts/dev-server.js && node --check "api/[...path].js"`
Expected: 오류 없음

- [ ] **Step 8: 커밋**

```bash
git add handlers/member-login.js handlers/member-logout.js handlers/me.js scripts/dev-server.js "api/[...path].js" .env.local.example
git commit -m "feat: add passwordless email login for members (session cookie)"
```

---

## Task 4: 부서/기업 목표 생성 API 재작성 (월/상위목표/3개 제한 검증)

**Files:**
- Modify: `handlers/okrs/index.js` (전체 교체)
- Modify: `api/[...path].js` (okrs/[id] 라우트 제거 — Task 5에서 파일도 삭제)

**Interfaces:**
- Produces: `POST /api/okrs { level:'회사', title, quarter } -> 201 {id}`; `POST /api/okrs { level:'조직', title, month, parent, owner } -> 201 {id}` / `400 {error}` (레벨 '개인' 요청, 상위 목표 누락/불일치, 3개 초과 시)

- [ ] **Step 1: `handlers/okrs/index.js` 전체 교체**

```js
import { sql } from '../_lib/db.js';

// '2026-08' -> '2026-Q3'
function quarterFromMonth(month) {
  const [year, m] = month.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${year}-Q${q}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
  if (b.level === '개인') return res.status(400).json({ error: '개인 목표는 /api/my-goals로 만들어주세요' });
  if (b.level !== '회사' && b.level !== '조직') return res.status(400).json({ error: 'level must be 회사 or 조직' });

  try {
    if (b.level === '조직') {
      if (!b.month) return res.status(400).json({ error: '월을 선택해주세요' });
      if (!b.parent) return res.status(400).json({ error: '상위 기업 목표를 선택해주세요' });

      const [parent] = await sql`SELECT id, level FROM okrs WHERE id = ${b.parent}`;
      if (!parent || parent.level !== '회사') {
        return res.status(400).json({ error: '상위 목표는 기업 목표여야 해요' });
      }

      const owner = (b.owner || '-').trim() || '-';
      const [{ count }] = await sql`
        SELECT count(*)::int AS count FROM okrs
        WHERE level = '조직' AND owner = ${owner} AND month = ${b.month}`;
      if (count >= 3) {
        return res.status(400).json({ error: `${owner} 팀은 ${b.month}에 이미 목표가 3개 있어요` });
      }

      const [row] = await sql`
        INSERT INTO okrs (quarter, month, level, title, owner, parent_id, progress, unit, target)
        VALUES (${quarterFromMonth(b.month)}, ${b.month}, '조직', ${b.title.trim()}, ${owner}, ${b.parent}, 0, '%', 100)
        RETURNING id`;
      return res.status(201).json({ id: row.id });
    }

    // 회사
    const [row] = await sql`
      INSERT INTO okrs (quarter, level, title, owner, progress, unit, target)
      VALUES (${b.quarter || '2026-Q3'}, '회사', ${b.title.trim()}, '전사', 0, '%', 100)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OKR' });
  }
}
```

- [ ] **Step 2: 문법 확인**

Run: `node --check "handlers/okrs/index.js"`
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add handlers/okrs/index.js
git commit -m "feat: restrict /api/okrs to 회사/조직, validate month/parent/3-per-month cap"
```

---

## Task 5: 개인 목표 생성 API + 체크리스트 CRUD API + 죽은 코드 제거

**Files:**
- Create: `handlers/my-goals/index.js`
- Create: `handlers/okr-tasks/index.js`
- Create: `handlers/okr-tasks/[id].js`
- Delete: `handlers/okrs/[id].js` (더 이상 아무도 호출하지 않는 수동 progress-patch 엔드포인트 — Task 8에서 프론트 슬라이더도 제거)
- Modify: `api/[...path].js` (okrsId import/route 제거, my-goals·okr-tasks 라우트 추가)

**Interfaces:**
- Consumes: `requireMemberAuth` from Task 2
- Produces: `POST /api/my-goals {parentId, title} -> 201 {id}`; `POST /api/okr-tasks {okrId, title} -> 201 {id}`; `PATCH /api/okr-tasks/:id {done} -> 200 {ok:true}`; `DELETE /api/okr-tasks/:id -> 200 {ok:true}`

- [ ] **Step 1: `handlers/my-goals/index.js` 작성**

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
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { parentId, title } = req.body || {};
  if (!parentId) return res.status(400).json({ error: '연결할 부서 목표를 선택해주세요' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const [parent] = await sql`SELECT id, quarter, month, level FROM okrs WHERE id = ${parentId}`;
    if (!parent || parent.level !== '조직') {
      return res.status(400).json({ error: '상위 목표는 부서 목표여야 해요' });
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

- [ ] **Step 2: `handlers/okr-tasks/index.js` 작성**

```js
/**
 * handlers/okr-tasks/index.js
 *
 * POST { okrId, title } -> 201 { id }
 *
 * 본인이 소유한 개인 목표(okrs.member_id = 세션 memberId)에만 할 일을
 * 추가할 수 있다.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { okrId, title } = req.body || {};
  if (!okrId || !title || !title.trim()) return res.status(400).json({ error: 'okrId and title are required' });

  try {
    const [okr] = await sql`SELECT id, member_id FROM okrs WHERE id = ${okrId}`;
    if (!okr || okr.member_id !== memberId) {
      return res.status(403).json({ error: '본인 목표에만 할 일을 추가할 수 있어요' });
    }

    const [row] = await sql`INSERT INTO okr_tasks (okr_id, title) VALUES (${okrId}, ${title.trim()}) RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task' });
  }
}
```

- [ ] **Step 3: `handlers/okr-tasks/[id].js` 작성**

```js
/**
 * handlers/okr-tasks/[id].js
 *
 * PATCH { done } -> 200 { ok: true }   체크/해제
 * DELETE         -> 200 { ok: true }   삭제
 *
 * 두 메서드 모두 이 task가 속한 okrs.member_id가 세션 memberId와 같을 때만
 * 허용한다.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';

async function loadOwnedTask(id, memberId) {
  const [row] = await sql`
    SELECT t.id FROM okr_tasks t
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
      if (!(await loadOwnedTask(id, memberId))) return res.status(403).json({ error: '본인 할 일만 수정할 수 있어요' });
      await sql`UPDATE okr_tasks SET done = ${done} WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (!(await loadOwnedTask(id, memberId))) return res.status(403).json({ error: '본인 할 일만 삭제할 수 있어요' });
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

- [ ] **Step 4: 죽은 코드 제거 — `handlers/okrs/[id].js` 삭제**

```bash
git rm "handlers/okrs/[id].js"
```

- [ ] **Step 5: `api/[...path].js` 갱신**

`import okrsId from '../handlers/okrs/[id].js';` 줄 삭제. 대신 추가:
```js
import myGoalsIndex from '../handlers/my-goals/index.js';
import okrTasksIndex from '../handlers/okr-tasks/index.js';
import okrTasksId from '../handlers/okr-tasks/[id].js';
```
`ROUTES` 배열에서 `{ pattern: ['okrs', ':id'], handler: okrsId },` 줄 삭제. 대신 `{ pattern: ['okrs'], handler: okrsIndex },` 다음 줄에 추가:
```js
  { pattern: ['my-goals'], handler: myGoalsIndex },
  { pattern: ['okr-tasks'], handler: okrTasksIndex },
  { pattern: ['okr-tasks', ':id'], handler: okrTasksId },
```

- [ ] **Step 6: 문법 확인**

Run: `node --check "handlers/my-goals/index.js" && node --check "handlers/okr-tasks/index.js" && node --check "handlers/okr-tasks/[id].js" && node --check "api/[...path].js"`
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add handlers/my-goals handlers/okr-tasks "api/[...path].js"
git commit -m "feat: add personal-goal + checklist CRUD APIs, remove dead progress-patch endpoint"
```

---

## Task 6: 공개 데이터 응답에 month/member/okr_tasks 포함

**Files:**
- Modify: `handlers/public-data.js`
- Modify: `handlers/all.js`

**Interfaces:**
- Produces: `okrs[i]`에 `month`, `member` 필드 추가; 응답에 `okrTasks: [{id, okrId, title, done}]` 배열 추가 (두 엔드포인트 동일 shape)

- [ ] **Step 1: `handlers/public-data.js` 수정**

`Promise.all([...])` 배열에 okr_tasks 쿼리 추가 (okrs 쿼리 다음 줄):
```js
      sql`SELECT * FROM okr_tasks`,
```
구조분해 대상 변수에도 추가 (`[members, okrs, evals, ...]` → `[members, okrs, okrTasks, evals, ...]`, 이어지는 변수들도 한 칸씩 밀림에 주의).

`okrs_out` 매핑에 필드 추가:
```js
    const okrs_out = okrs.map(o => ({
      id: o.id, quarter: o.quarter, month: o.month, level: o.level, title: o.title, owner: o.owner,
      parent: o.parent_id, member: o.member_id, progress: o.progress, unit: o.unit, target: o.target
    }));
```

새 매핑 추가:
```js
    const okrTasks_out = okrTasks.map(t => ({ id: t.id, okrId: t.okr_id, title: t.title, done: t.done }));
```

응답 객체에 추가:
```js
    res.status(200).json({
      members: members.map(m => ({ id: m.id, name: m.name })),
      okrs: okrs_out,
      okrTasks: okrTasks_out,
      evals: evals_out,
      calibration: calibration_out,
      oneonones: oneonones_out
    });
```

- [ ] **Step 2: `handlers/all.js`에 동일하게 반영**

`Promise.all([...])` 배열에 okr_tasks 쿼리 추가, `okrs_out` 매핑에 `month`/`member` 추가, `okrTasks_out` 매핑 추가, 최종 `res.status(200).json({...})`에 `okrTasks: okrTasks_out` 추가 — public-data.js와 동일한 패턴.

- [ ] **Step 3: 문법 확인**

Run: `node --check handlers/public-data.js && node --check handlers/all.js`
Expected: 오류 없음

- [ ] **Step 4: 커밋**

```bash
git add handlers/public-data.js handlers/all.js
git commit -m "feat: expose okr month/member and okr_tasks in public-data/all"
```

---

## Task 7: 프론트 — API 헬퍼 에러 메시지 전달 + DB 상태 확장

**Files:**
- Modify: `index.html` (약 429-482줄: `apiGet`/`apiPost`/`apiPatch`/`apiPut`/`apiDelete`, `DB` 객체, `refreshPublicData`/`refreshHrData`, `initApp`)

**Interfaces:**
- Produces: `apiPost`/`apiPatch`/`apiPut`/`apiDelete`가 실패 시 서버가 보낸 `{error}` 메시지를 `Error.message`로 던짐 (지금은 `'POST '+path+' failed'`라는 의미 없는 문자열만 던져서, Task 4/5의 검증 에러 메시지를 사용자에게 보여줄 수 없음). `DB.okrTasks` 배열, 전역 `let me = null;` 추가

- [ ] **Step 1: API 헬퍼를 교체**

`apiGet`부터 `apiDelete`까지(429-433줄)를 아래로 교체:

```js
async function apiGet(path){ const r = await fetch(API+path, {headers:{...hrHeaders}}); const data = await r.json().catch(()=>null); if(!r.ok) throw new Error((data&&data.error)||('GET '+path+' failed')); return data; }
async function apiPost(path, body){ const r = await fetch(API+path, {method:'POST', headers:{'Content-Type':'application/json', ...hrHeaders}, body:JSON.stringify(body)}); const data = await r.json().catch(()=>null); if(!r.ok) throw new Error((data&&data.error)||('POST '+path+' failed')); return data; }
async function apiPatch(path, body){ const r = await fetch(API+path, {method:'PATCH', headers:{'Content-Type':'application/json', ...hrHeaders}, body:JSON.stringify(body)}); const data = await r.json().catch(()=>null); if(!r.ok) throw new Error((data&&data.error)||('PATCH '+path+' failed')); return data; }
async function apiPut(path, body){ const r = await fetch(API+path, {method:'PUT', headers:{'Content-Type':'application/json', ...hrHeaders}, body:JSON.stringify(body)}); const data = await r.json().catch(()=>null); if(!r.ok) throw new Error((data&&data.error)||('PUT '+path+' failed')); return data; }
async function apiDelete(path){ const r = await fetch(API+path, {method:'DELETE', headers:{...hrHeaders}}); const data = await r.json().catch(()=>null); if(!r.ok) throw new Error((data&&data.error)||('DELETE '+path+' failed')); return data; }
```

- [ ] **Step 2: `DB`/세션 전역 상태 확장**

`let DB = { members:[], roster:[], jobs:[], candidates:[], okrs:[], evals:[], calibration:{}, oneonones:[] };` 를:
```js
let DB = { members:[], roster:[], jobs:[], candidates:[], okrs:[], okrTasks:[], evals:[], calibration:{}, oneonones:[] };
let me = null; // 마이페이지 로그인 상태: {id, name, team} | null
```

- [ ] **Step 3: `refreshPublicData`/`refreshHrData`에 okrTasks 반영**

`refreshPublicData`:
```js
async function refreshPublicData(){
  const d = await apiGet('/public-data');
  DB.roster = d.members;
  DB.okrs = d.okrs; DB.okrTasks = d.okrTasks; DB.evals = d.evals; DB.calibration = d.calibration; DB.oneonones = d.oneonones;
}
```
`refreshHrData`도 동일하게 `DB.okrTasks = d.okrTasks;` 추가 (두 함수 모두 `DB.okrs = d.okrs;` 바로 다음 줄).

- [ ] **Step 4: `initApp`에서 로그인 상태 복원**

```js
async function initApp(){
  await refreshPublicData();
  try { me = await apiGet('/me'); } catch { me = null; }
  renderAll();
}
```

- [ ] **Step 5: 브라우저에서 문법 오류 없는지 확인**

`index.html`을 텍스트 에디터로 다시 읽어 위 5개 함수 교체 부분에 괄호 짝이 안 맞거나 오타가 없는지 확인 (이 파일은 정적 HTML이라 `node --check`로 검증 불가 — 육안 검토 후 Task 12에서 실제 페이지 로드로 최종 확인).

- [ ] **Step 6: 커밋**

```bash
git add index.html
git commit -m "feat: surface server error messages in API helpers, track okrTasks/me state"
```

---

## Task 8: 프론트 — 목표 계층 집계 유틸 함수

**Files:**
- Modify: `index.html` (OKR 섹션 최상단, 현재 `/* ---------- OKR ---------- */` 주석 바로 위에 새 블록 삽입)

**Interfaces:**
- Consumes: `DB.okrs` (`{id, quarter, month, level, title, owner, parent, member, progress, unit, target}`), `DB.okrTasks` (`{id, okrId, title, done}`)
- Produces: `monthsOfQuarter(quarter): string[]`, `individualProgress(okr): number`, `orgProgress(okr): number`, `companyMonthProgress(companyOkr, month): number|null`, `companyQuarterProgress(companyOkr): number` — Task 9(관리 화면)·10(대시보드)·13(마이페이지)이 모두 이 5개 함수를 그대로 호출한다.

- [ ] **Step 1: 유틸 블록 삽입**

`/* ---------- OKR ---------- */` 주석 바로 앞에 삽입:

```js
/* ---------- 목표 계층 집계 유틸 ---------- */
// '2026-Q3' -> ['2026-07','2026-08','2026-09']
function monthsOfQuarter(quarter){
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter||'');
  if(!m) return [];
  const year = m[1], q = Number(m[2]);
  const startMonth = (q-1)*3 + 1;
  return [0,1,2].map(i => `${year}-${String(startMonth+i).padStart(2,'0')}`);
}
function individualProgress(okr){
  const tasks = DB.okrTasks.filter(t=>t.okrId===okr.id);
  if(!tasks.length) return 0;
  return Math.round(100 * tasks.filter(t=>t.done).length / tasks.length);
}
function orgProgress(okr){
  const children = DB.okrs.filter(o=>o.level==='개인' && o.parent===okr.id);
  if(!children.length) return 0;
  return Math.round(children.reduce((a,c)=>a+individualProgress(c),0) / children.length);
}
function companyMonthProgress(companyOkr, month){
  const orgs = DB.okrs.filter(o=>o.level==='조직' && o.parent===companyOkr.id && o.month===month);
  if(!orgs.length) return null;
  return Math.round(orgs.reduce((a,o)=>a+orgProgress(o),0) / orgs.length);
}
function companyQuarterProgress(companyOkr){
  const orgs = DB.okrs.filter(o=>o.level==='조직' && o.parent===companyOkr.id);
  if(!orgs.length) return 0;
  return Math.round(orgs.reduce((a,o)=>a+orgProgress(o),0) / orgs.length);
}
```

- [ ] **Step 2: 커밋**

```bash
git add index.html
git commit -m "feat: add client-side goal-hierarchy rollup utilities"
```

---

## Task 9: 프론트 — 목표(OKR) 관리 화면 재작성 (기업/부서, 개인 생성 UI 제거)

**Files:**
- Modify: `index.html` (마크업: 기존 `<!-- OKR -->` 뷰 안내문 수정 없음 그대로 유지; JS: `openOkrModal`, `saveOkr`, `updateOkrProgress`, `renderOkr` 전체 교체)

**Interfaces:**
- Consumes: Task 8의 5개 유틸 함수, Task 4의 `POST /api/okrs`
- Produces: `renderOkr()` — `renderAll()`이 계속 이 이름으로 호출하므로 함수명은 유지

- [ ] **Step 1: `openOkrModal`/`saveOkr`/`updateOkrProgress` 교체**

`/* ---------- OKR ---------- */` 아래 `function openOkrModal(){...}`부터 `async function updateOkrProgress(id, val){...}`까지(기존 991-1029줄 범위)를 통째로 아래로 교체:

```js
function openOkrModal(){
  showModal(`
    <h3>새 목표 추가</h3>
    <div class="modal-sub">개인 목표는 마이페이지에서 만들 수 있어요</div>
    <div class="form-row">
      <div class="field"><label>레벨</label><select id="f-olevel" onchange="onOkrLevelChange()"><option value="회사">기업</option><option value="조직" selected>부서</option></select></div>
      <div class="field" id="f-oquarter-wrap"><label>분기</label><input id="f-oquarter" placeholder="2026-Q3" value="2026-Q3"></div>
      <div class="field" id="f-omonth-wrap"><label>월</label><input id="f-omonth" type="month"></div>
    </div>
    <div class="field"><label>목표 제목</label><input id="f-otitle" placeholder="예: 채용 리드타임 단축"></div>
    <div class="form-row" id="f-oorg-fields">
      <div class="field"><label>부서(팀)명</label><input id="f-oowner" placeholder="예: 세일즈팀"></div>
      <div class="field"><label>상위 기업 목표</label>
        <select id="f-oparent"><option value="">선택 안함</option>${DB.okrs.filter(o=>o.level==='회사').map(o=>`<option value="${o.id}">${escapeHtml(o.title)} (${escapeHtml(o.quarter)})</option>`).join('')}</select>
      </div>
    </div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveOkr()">목표 생성</button></div>
  `);
  onOkrLevelChange();
}
function onOkrLevelChange(){
  const level = document.getElementById('f-olevel').value;
  document.getElementById('f-oquarter-wrap').style.display = level==='회사' ? '' : 'none';
  document.getElementById('f-omonth-wrap').style.display = level==='조직' ? '' : 'none';
  document.getElementById('f-oorg-fields').style.display = level==='조직' ? '' : 'none';
}
async function saveOkr(){
  const level = document.getElementById('f-olevel').value;
  const title = document.getElementById('f-otitle').value.trim();
  if(!title) return alert('목표 제목을 입력해주세요');

  try{
    if(level==='회사'){
      await apiPost('/okrs', {level, title, quarter:document.getElementById('f-oquarter').value||'2026-Q3'});
    } else {
      const month = document.getElementById('f-omonth').value;
      const parent = document.getElementById('f-oparent').value;
      if(!month) return alert('월을 선택해주세요');
      if(!parent) return alert('상위 기업 목표를 선택해주세요');
      await apiPost('/okrs', {level, title, month, parent, owner:document.getElementById('f-oowner').value||'-'});
    }
  }catch(err){
    return alert(err.message);
  }
  await refreshDB(); closeModal(); renderOkr();
}
```

- [ ] **Step 2: `renderOkr` 교체**

기존 `/* ---------- OKR RENDER ---------- */` 아래 `function renderOkr(){...}`(기존 1298-1319줄)를 아래로 교체:

```js
/* ---------- OKR RENDER ---------- */
function renderOkr(){
  const companies = DB.okrs.filter(o=>o.level==='회사');
  const orgs = DB.okrs.filter(o=>o.level==='조직');
  document.getElementById('okr-list').innerHTML = `
    <div class="section-head"><h3>기업 목표</h3></div>
    ${companies.map(c=>{
      const qp = companyQuarterProgress(c);
      return `
      <div style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;margin-bottom:6px;">
          <span>${escapeHtml(c.title)} <span class="badge grey">${escapeHtml(c.quarter)}</span></span>
          <span>${qp}%</span>
        </div>
        <div class="bar" style="margin-bottom:8px;"><i style="width:${qp}%"></i></div>
        <div style="display:flex;gap:8px;">
          ${monthsOfQuarter(c.quarter).map(m=>{
            const mp = companyMonthProgress(c, m);
            return `<div style="flex:1;text-align:center;font-size:11.5px;color:var(--sub);">
              <div>${m.slice(5)}월</div>
              <div class="bar" style="margin:4px 0;"><i style="width:${mp==null?0:mp}%"></i></div>
              <div>${mp==null?'-':mp+'%'}</div>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    }).join('') || '<div class="empty">등록된 기업 목표가 없어요</div>'}

    <div class="section-head" style="margin-top:24px;"><h3>부서 목표</h3></div>
    ${orgs.map(o=>{
      const parent = DB.okrs.find(x=>x.id===o.parent);
      const p = orgProgress(o);
      return `
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;margin-bottom:6px;">
          <span>${escapeHtml(o.title)} <span class="badge grey">${escapeHtml(o.month||'')}</span> <span style="color:var(--sub);font-weight:500;">${escapeHtml(o.owner)}</span>${parent?` <span style="color:var(--sub);font-weight:500;">↳ 상위: ${escapeHtml(parent.title)}</span>`:''}</span>
          <span>${p}%</span>
        </div>
        <div class="bar"><i style="width:${p}%"></i></div>
      </div>`;
    }).join('') || '<div class="empty">등록된 부서 목표가 없어요</div>'}
  `;
}
```

- [ ] **Step 3: 페이지 안내문 갱신**

`<!-- OKR -->` 뷰의 `<p>회사 · 조직 · 개인 3단계 목표를 등록하고 진척률을 추적하세요</p>` 를:
```html
<p>기업(분기) · 부서(월별) 목표를 등록하세요. 개인 목표는 마이페이지에서 만들어요</p>
```

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: rewrite goal management screen for company/dept hierarchy, drop manual progress slider"
```

---

## Task 10: 프론트 — 성과 대시보드에 기업/부서 달성률 추가

**Files:**
- Modify: `index.html` (마크업: `view-perfdash`에 컨테이너 2개 추가; JS: `renderPerfDash` 교체)

**Interfaces:**
- Consumes: Task 8 유틸 함수

- [ ] **Step 1: 마크업 추가**

`<div class="grid4" id="perfdash-kpis"></div>` 바로 다음, 기존 "최근 성과관리 활동" `<div class="section">` 바로 앞에 삽입:

```html
      <div class="section">
        <div class="section-head"><h3>기업 목표 달성률</h3><div class="desc">분기 목표별 월간 달성률이에요</div></div>
        <div id="perfdash-goal-cards"></div>
      </div>
      <div class="section">
        <div class="section-head"><h3>부서별 달성률</h3></div>
        <div id="perfdash-dept-bars"></div>
      </div>
```

- [ ] **Step 2: `renderPerfDash` 교체**

기존 `function renderPerfDash(){...}`(1226-1240줄)를 아래로 교체:

```js
/* 성과 대시보드 — 전사 공개. 개인정보(구성원·지원자)는 쓰지 않아요. */
function renderPerfDash(){
  const companies = DB.okrs.filter(o=>o.level==='회사');
  const companyAvg = companies.length ? Math.round(companies.reduce((a,c)=>a+companyQuarterProgress(c),0)/companies.length) : 0;

  document.getElementById('perfdash-kpis').innerHTML = `
    <div class="kpi"><div class="label">기업 목표 평균 달성률</div><div class="value">${companyAvg}%</div></div>
    <div class="kpi"><div class="label">진행중인 기업 목표</div><div class="value">${companies.length}건</div></div>
    <div class="kpi"><div class="label">등록된 평가</div><div class="value">${DB.evals.length}건</div></div>
    <div class="kpi"><div class="label">원온원 기록</div><div class="value">${DB.oneonones.length}건</div></div>
  `;

  document.getElementById('perfdash-goal-cards').innerHTML = companies.map(c=>{
    const qp = companyQuarterProgress(c);
    return `
    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:8px;">
        <span>${escapeHtml(c.title)} <span class="badge grey">${escapeHtml(c.quarter)}</span></span><span>${qp}%</span>
      </div>
      <div style="display:flex;gap:10px;">
        ${monthsOfQuarter(c.quarter).map(m=>{
          const mp = companyMonthProgress(c, m);
          return `<div style="flex:1;text-align:center;font-size:11.5px;color:var(--sub);">
            <div>${m.slice(5)}월</div>
            <div class="bar" style="margin:4px 0;"><i style="width:${mp==null?0:mp}%"></i></div>
            <div>${mp==null?'-':mp+'%'}</div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('') || '<div class="empty">등록된 기업 목표가 없어요</div>';

  const teams = [...new Set(DB.okrs.filter(o=>o.level==='조직').map(o=>o.owner))];
  document.getElementById('perfdash-dept-bars').innerHTML = teams.map(team=>{
    const orgs = DB.okrs.filter(o=>o.level==='조직' && o.owner===team);
    const avg = orgs.length ? Math.round(orgs.reduce((a,o)=>a+orgProgress(o),0)/orgs.length) : 0;
    return `<div class="cal-row">
      <div class="name">${escapeHtml(team)}</div>
      <div class="barwrap"><div class="bar"><i style="width:${avg}%"></i></div></div>
      <div class="pct">${avg}%</div>
    </div>`;
  }).join('') || '<div class="empty">등록된 부서 목표가 없어요</div>';

  const events = [];
  DB.oneonones.forEach(m=>events.push({sort:m.date, date:dayKeyOf(m.date), text:`[원온원] ${escapeHtml(m.employeeName)} 님과 면담 기록`}));
  DB.evals.forEach(e=>events.push({sort:e.quarter, date:escapeHtml(e.quarter), text:`[평가] ${escapeHtml(e.employeeName)} 님 ${escapeHtml(e.quarter)} 평가 등록`}));
  DB.okrs.filter(o=>o.level!=='개인').forEach(o=>events.push({sort:o.month||o.quarter, date:escapeHtml(o.month||o.quarter), text:`[목표] ${escapeHtml(o.level)} 목표 「${escapeHtml(o.title)}」 등록`}));
  renderTimelineInto('perfdash-timeline', events, '아직 성과관리 기록이 없어요');
}
```

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "feat: show company/department achievement rates on 성과 대시보드"
```

---

## Task 11: 프론트 — 마이페이지 마크업(로그인 폼 + 개인 화면)

**Files:**
- Modify: `index.html` (nav에 항목 추가, `view-oneonone` 다음에 `view-mypage` 추가)

- [ ] **Step 1: nav 항목 추가**

`<button class="nav-item" data-view="oneonone">💬 원온원</button>` 다음, `<div class="nav-sep">시스템</div>` 바로 앞에 삽입:

```html
    <div class="nav-sep">마이페이지</div>
    <button class="nav-item" data-view="mypage">🙋 마이페이지</button>
```

- [ ] **Step 2: 뷰 마크업 추가**

`<!-- ONE ON ONE -->` 뷰가 끝나는 `</div>`(기존 399줄) 다음, `<!-- DATA -->` 뷰 앞에 삽입:

```html
    <!-- MYPAGE -->
    <div class="view" id="view-mypage">
      <div class="page-head"><div><h1>마이페이지</h1><p>내 목표·평가·원온원을 한 곳에서 확인해요</p></div></div>

      <div id="mypage-login">
        <div class="section">
          <div class="section-head"><h3>로그인</h3><div class="desc">인사팀에 등록된 이메일을 입력하면 내 화면이 열려요 (비밀번호 없음)</div></div>
          <div class="field"><label>이메일</label><input id="f-my-email" placeholder="you@selfdiylab.com" onkeydown="if(event.key==='Enter')submitMyLogin()"></div>
          <div id="mypage-login-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
          <button class="btn primary" onclick="submitMyLogin()">로그인</button>
        </div>
      </div>

      <div id="mypage-home" style="display:none;">
        <div class="page-head">
          <div><h1 id="mypage-hello" style="font-size:20px;"></h1><p>이번 달 내 목표와 최근 평가·원온원 기록이에요</p></div>
          <button class="btn ghost" onclick="submitMyLogout()">로그아웃</button>
        </div>
        <div class="grid4" id="mypage-kpis"></div>

        <div class="section">
          <div class="section-head">
            <div><h3>이번 달 내 목표</h3><div class="desc">우리 팀의 이번 달 목표를 골라 개인 목표를 만들고, 할 일을 체크하면 진척률이 자동 계산돼요</div></div>
            <button class="btn primary sm" onclick="openMyGoalModal()">+ 목표 추가</button>
          </div>
          <div id="mypage-goals"></div>
        </div>

        <div class="section">
          <div class="section-head"><h3>내 평가 기록</h3></div>
          <div id="mypage-evals"></div>
        </div>

        <div class="section">
          <div class="section-head"><h3>내 원온원 기록</h3></div>
          <div class="timeline" id="mypage-oneonones"></div>
        </div>
      </div>
    </div>

```

- [ ] **Step 2: 커밋**

```bash
git add index.html
git commit -m "feat: add 마이페이지 nav item and view markup"
```

---

## Task 12: 프론트 — 마이페이지 로그인/렌더/목표·할일 CRUD 로직

**Files:**
- Modify: `index.html` (새 스크립트 블록 추가 — `/* ---------- DATA MGMT ---------- */` 바로 앞에 삽입)
- Modify: `index.html` (`renderAll()`에 `renderMyPage()` 추가)

**Interfaces:**
- Consumes: Task 8 유틸 함수, Task 3/5의 `/api/member-login`, `/api/member-logout`, `/api/me`, `/api/my-goals`, `/api/okr-tasks*`, `monthKeyOf`(기존 `renderHrDash`에서 이미 쓰는 함수), `dayKeyOf`/`renderTimelineInto`(기존), `gradeFor`/`competency`(기존 EVAL 섹션)

- [ ] **Step 1: 마이페이지 스크립트 블록 삽입**

`/* ---------- DATA MGMT ---------- */` 주석 바로 앞에 삽입:

```js
/* ---------- 마이페이지 ---------- */
async function submitMyLogin(){
  const input = document.getElementById('f-my-email');
  const errBox = document.getElementById('mypage-login-error');
  errBox.style.display = 'none';
  const email = input.value.trim();
  if(!email){ errBox.textContent = '이메일을 입력해주세요'; errBox.style.display = 'block'; return; }

  try{
    await apiPost('/member-login', {email});
    me = await apiGet('/me');
    renderMyPage();
  }catch(err){
    errBox.textContent = err.message; errBox.style.display = 'block';
  }
}
async function submitMyLogout(){
  await apiPost('/member-logout', {});
  me = null;
  renderMyPage();
}
function renderMyPage(){
  const loginBox = document.getElementById('mypage-login');
  const homeBox = document.getElementById('mypage-home');
  if(!me){ loginBox.style.display=''; homeBox.style.display='none'; return; }
  loginBox.style.display='none'; homeBox.style.display='';
  document.getElementById('mypage-hello').textContent = `${me.name}님, 안녕하세요`;

  const thisMonth = monthKeyOf(new Date());
  const myGoals = DB.okrs.filter(o=>o.level==='개인' && o.member===me.id);
  const myAvg = myGoals.length ? Math.round(myGoals.reduce((a,g)=>a+individualProgress(g),0)/myGoals.length) : 0;

  const teamOrgsThisMonth = DB.okrs.filter(o=>o.level==='조직' && o.owner===me.team && o.month===thisMonth);
  const teamAvg = teamOrgsThisMonth.length ? Math.round(teamOrgsThisMonth.reduce((a,o)=>a+orgProgress(o),0)/teamOrgsThisMonth.length) : 0;

  const companyIds = [...new Set(teamOrgsThisMonth.map(o=>o.parent))];
  const companyProgresses = companyIds.map(id=>DB.okrs.find(o=>o.id===id)).filter(Boolean).map(companyQuarterProgress);
  const companyAvg = companyProgresses.length ? Math.round(companyProgresses.reduce((a,v)=>a+v,0)/companyProgresses.length) : 0;

  document.getElementById('mypage-kpis').innerHTML = `
    <div class="kpi"><div class="label">내 목표 달성률</div><div class="value">${myAvg}%</div></div>
    <div class="kpi"><div class="label">우리 팀 이번 달 달성률</div><div class="value">${teamAvg}%</div></div>
    <div class="kpi"><div class="label">우리 회사 이번 분기 달성률</div><div class="value">${companyAvg}%</div></div>
    <div class="kpi"><div class="label">진행중인 내 목표</div><div class="value">${myGoals.length}건</div></div>
  `;

  document.getElementById('mypage-goals').innerHTML = myGoals.map(g=>{
    const org = DB.okrs.find(o=>o.id===g.parent);
    const company = org ? DB.okrs.find(o=>o.id===org.parent) : null;
    const tasks = DB.okrTasks.filter(t=>t.okrId===g.id);
    const p = individualProgress(g);
    return `
    <div style="margin-bottom:18px;border-bottom:1px solid var(--border);padding-bottom:14px;">
      <div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;margin-bottom:4px;">
        <span>${escapeHtml(g.title)}</span><span>${p}%</span>
      </div>
      <div class="bar" style="margin-bottom:6px;"><i style="width:${p}%"></i></div>
      <div style="font-size:11.5px;color:var(--sub);margin-bottom:8px;">
        ${org?`↳ 팀 목표: ${escapeHtml(org.title)} (${orgProgress(org)}%)`:''}${company?` → 회사 목표: ${escapeHtml(company.title)} (${companyQuarterProgress(company)}%)`:''}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px;">
        ${tasks.map(t=>`
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
            <input type="checkbox" ${t.done?'checked':''} onchange="toggleMyTask('${t.id}', this.checked)">
            <span style="flex:1;${t.done?'text-decoration:line-through;color:var(--sub);':''}">${escapeHtml(t.title)}</span>
            <button class="btn ghost sm" onclick="deleteMyTask('${t.id}')">삭제</button>
          </label>`).join('') || '<div class="empty">할 일이 없어요</div>'}
      </div>
      <div style="display:flex;gap:8px;">
        <input id="new-task-${g.id}" placeholder="할 일 추가" style="flex:1;border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:12.5px;" onkeydown="if(event.key==='Enter')addMyTask('${g.id}')">
        <button class="btn sm" onclick="addMyTask('${g.id}')">추가</button>
      </div>
    </div>`;
  }).join('') || '<div class="empty">이번 달 목표가 없어요. + 목표 추가로 시작해보세요</div>';

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
function openMyGoalModal(){
  const thisMonth = monthKeyOf(new Date());
  const myTeamOrgs = DB.okrs.filter(o=>o.level==='조직' && o.owner===me.team && o.month===thisMonth);
  showModal(`
    <h3>이번 달 내 목표 추가</h3>
    <div class="modal-sub">우리 팀의 이번 달 목표 중 하나를 골라 연결해요</div>
    <div class="field"><label>연결할 팀 목표</label>
      <select id="f-mygoal-parent">${myTeamOrgs.map(o=>`<option value="${o.id}">${escapeHtml(o.title)}</option>`).join('') || '<option value="">이번 달 등록된 팀 목표가 없어요</option>'}</select>
    </div>
    <div class="field"><label>목표 제목</label><input id="f-mygoal-title" placeholder="예: 신규 랜딩페이지 카피 작성"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveMyGoal()">추가</button></div>
  `);
}
async function saveMyGoal(){
  const parentId = document.getElementById('f-mygoal-parent').value;
  const title = document.getElementById('f-mygoal-title').value.trim();
  if(!parentId) return alert('연결할 팀 목표가 없어요. 먼저 목표 페이지에서 이번 달 팀 목표를 만들어주세요');
  if(!title) return alert('목표 제목을 입력해주세요');
  try{ await apiPost('/my-goals', {parentId, title}); }catch(err){ return alert(err.message); }
  await refreshDB(); closeModal(); renderMyPage();
}
async function addMyTask(okrId){
  const input = document.getElementById('new-task-'+okrId);
  const title = input.value.trim();
  if(!title) return;
  try{ await apiPost('/okr-tasks', {okrId, title}); }catch(err){ return alert(err.message); }
  await refreshDB(); renderMyPage();
}
async function toggleMyTask(id, done){
  try{ await apiPatch('/okr-tasks/'+id, {done}); }catch(err){ alert(err.message); }
  await refreshDB(); renderMyPage();
}
async function deleteMyTask(id){
  try{ await apiDelete('/okr-tasks/'+id); }catch(err){ alert(err.message); }
  await refreshDB(); renderMyPage();
}
```

- [ ] **Step 2: `renderAll()`에 등록**

```js
function renderAll(){
  renderPerfDash();
  renderHrDash();
  renderMembers();
  if(currentMemberId) renderMemberProfile();
  renderJobs();
  renderCandidates();
  renderOkr();
  renderEval();
  renderCalibration();
  renderOneOnOne();
  renderMyPage();
}
```

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "feat: implement 마이페이지 login, goal/checklist CRUD, and cross-level progress summary"
```

---

## Task 13: 최종 로컬 검증 (사용자 실행 — DB 접속정보 필요)

이 에이전트가 작업한 샌드박스에는 `.env.local`(Neon `DATABASE_URL`)이 없어 실제 DB를 붙인 로컬 서버를 띄워 볼 수 없다. 코드 자체는 Task 1-12에서 문법 검증(`node --check`)까지 마쳤으므로, 아래는 사용자가 직접 확인하는 절차다.

- [ ] **Step 1: 마이그레이션 적용**

```bash
node scripts/run-sql.js sql/003_okr_hierarchy.sql
```

- [ ] **Step 2: `.env.local`에 `SESSION_SECRET` 추가** (`.env.local.example` 참고, 임의의 긴 문자열)

- [ ] **Step 3: 로컬 서버 기동**

```bash
node scripts/dev-server.js
```

- [ ] **Step 4: 브라우저에서 시나리오 확인** (`http://localhost:3000`)
  1. 목표 페이지에서 기업 목표 1개 생성 → 부서 목표 4개 시도(같은 팀·같은 달) → 4번째에서 "이미 목표가 3개 있어요" 에러 확인
  2. 마이페이지에서 구성원 이메일로 로그인(해당 구성원의 `email`이 구성원 정보에 미리 입력돼 있어야 함) → 개인 목표 추가 → 할 일 추가/체크 → 내 목표 달성률이 즉시 바뀌는지 확인
  3. 성과 대시보드에서 기업 목표 카드의 월별 막대와 부서별 달성률이 방금 만든 데이터를 반영하는지 확인
  4. 로그아웃 → 마이페이지가 다시 로그인 폼으로 돌아가는지 확인

- [ ] **Step 5: 실제 Vercel 배포 환경 변수에 `SESSION_SECRET` 추가** (Vercel 프로젝트 설정 → Environment Variables), 배포 후 프로덕션에서도 Step 4 시나리오 재확인

---

## Self-Review 체크리스트 (계획 작성자가 직접 확인)

- [x] 스펙의 "기업목표도 월 달성률" → Task 8의 `companyMonthProgress` + Task 9/10에서 월별 막대 렌더
- [x] 스펙의 "이메일만, 비밀번호 없음" → Task 3 `member-login.js`
- [x] 스펙의 "마이페이지에 목표+평가+원온원" → Task 12 `renderMyPage`
- [x] 스펙의 "부서당 월 3개 제한" → Task 4 서버 검증
- [x] 스펙의 "개인 목표는 체크리스트로만 집계" → Task 8 `individualProgress`
- [x] placeholder(TBD 등) 없음 — 전 태스크 실제 코드 포함
- [x] 함수명 일관성 확인: `renderOkr`/`renderPerfDash`/`renderMyPage`는 `renderAll()`에서 호출하는 이름과 정의하는 이름이 일치, `DB.okrs`의 `parent`/`member` 필드명이 Task 6(백엔드 매핑)과 Task 8-12(프론트 사용) 전체에서 동일하게 사용됨
