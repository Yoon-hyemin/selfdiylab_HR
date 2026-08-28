# 인재검색 실제 후보 리스트 가져오기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 크롬 확장이 사람인 검색결과 리스트 페이지에서 현재 화면의 후보들을 읽어, "연결 코드"로 인증된 HR 웹사이트 API를 통해 저장하고, "검색 진행" 화면에서 정렬·필터 가능한 표로 보여준다.

**Architecture:** 크롬 확장에 새 콘텐츠 스크립트(검색리스트 페이지 전용)와 팝업 UI(연결 코드 입력, 프로젝트 선택, 가져오기 버튼)를 추가한다. HR 사이트에는 계정별 연결 코드(해시 저장, bearer 토큰 인증) 발급 API, 리스트 후보 저장용 새 테이블+API를 추가한다. 기존 가상 후보 테이블(`talent_search_candidates`)과 채점 로직은 전혀 건드리지 않고, 완전히 새로운 테이블(`talent_search_list_candidates`)과 화면 섹션을 나란히 추가한다.

**Tech Stack:** Vanilla JS(프론트/확장), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`, Manifest V3 크롬 확장, `node --test`.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-27-talent-search-real-list-import-design.md` — 범위·안전장치는 이 문서 그대로.
- **이번 슬라이스 범위**: 리스트 후보 가져오기 + 저장 + 표시 + 클릭 시 원문 이동까지만. 자동 채점(Level1 등)을 리스트 후보에 적용하는 것, 여러 페이지 자동 순회, 중복 처리, 사람인 외 플랫폼은 전부 범위 밖 — 어떤 태스크에도 포함하지 않는다.
- **기존 가상 후보 파이프라인은 손대지 않는다** — `talent_search_candidates` 테이블, `handlers/talent-search-projects/[id]/candidates.js`, `index.html`의 `renderTalentSearchCandidatesScreen`/`simulateCandidate` 등은 이번 계획의 어떤 태스크에서도 수정하지 않는다(읽기만 함).
- **연결 코드는 계정 비밀번호와 동일한 수준으로 취급** — 평문 저장 안 함(해시만 저장), 발급 시 화면에 딱 한 번만 노출.
- API 응답 필드는 camelCase, DB 컬럼은 snake_case. 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에 반드시 등록한다.
- 인재검색 관련 쿠키세션 엔드포인트는 `requireTalentSearchAccess`(ADMIN 또는 `can_use_talent_search`)로 보호한다. 크롬 확장 전용 엔드포인트는 이번에 새로 만드는 `requireExtensionToken`으로 보호한다.
- 순수 로직(토큰 생성/해시, 리스트 후보 입력 검증, 리스트 페이지 DOM 파싱)은 `node --test`로 단위테스트한다. DB/HTTP/UI가 얽힌 부분은 로컬 dev 서버 + 실제 크롬으로 수동 검증한다(이 프로젝트의 기존 원칙과 동일).
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖(사용자 확인 후 별도 진행).
- 크롬 확장의 HR 사이트 API 호출 대상은 로컬 개발 시 `http://localhost:3000`이다 — `manifest.json`의 `host_permissions`에 이 오리진을 추가한다(배포 도메인 추가는 실제 배포 시점에 별도 진행, 이번 계획은 로컬 검증까지만).
- 커밋 메시지, 코드 주석은 한국어로 쓴다.

---

### Task 1: 연결 코드 발급 — DB 스키마 + 순수 헬퍼 함수

**Files:**
- Create: `sql/021_talent_search_list_import.sql`
- Create: `handlers/_lib/extensionToken.js`
- Create: `handlers/_lib/extensionToken.test.js`

**Interfaces:**
- Produces: `handlers/_lib/extensionToken.js`가 `export function generateExtensionToken()`(원문 코드, 48자 hex 문자열)과 `export function hashExtensionToken(token)`(sha256 hex, DB 조회용)를 export. Task 2가 이 두 함수를 그대로 쓴다. `sql/021_talent_search_list_import.sql`이 `talent_search_extension_tokens`와 `talent_search_list_candidates` 두 테이블을 만든다 — Task 2·3이 그대로 쓴다.

- [ ] **Step 1: SQL 마이그레이션 작성**

```sql
-- sql/021_talent_search_list_import.sql
--
-- 2026-08-27: 인재검색 "실제 후보 리스트 가져오기" 슬라이스.
--
-- talent_search_extension_tokens: 크롬 확장이 HR 사이트 API를 호출할 때
-- 쓰는 인증 코드. 계정 비밀번호와 같은 원칙 -- 원문은 저장하지 않고
-- 해시만 저장한다. 계정당 최대 1개(재발급하면 기존 걸 대체).
CREATE TABLE IF NOT EXISTS talent_search_extension_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- talent_search_list_candidates: 사람인 검색결과 리스트에서 가져온 실제
-- 후보. 기존 talent_search_candidates(가상 후보, 이력서 전체를 읽었다는
-- 전제의 raw 필드로 구성)와는 완전히 별개 테이블이다 -- 이번 슬라이스는
-- 채점을 하지 않으므로 그 테이블의 필드(resume_age_days 등)가 필요
-- 없고, 대신 리스트 화면에 실제로 보이는 필드만 그대로 저장한다.
CREATE TABLE IF NOT EXISTS talent_search_list_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id) ON DELETE CASCADE,
  platform text NOT NULL,
  masked_name text NOT NULL,
  gender text,
  age integer,
  career_summary text,
  recent_positions jsonb NOT NULL DEFAULT '[]',
  education text,
  tags jsonb NOT NULL DEFAULT '[]',
  badges jsonb NOT NULL DEFAULT '[]',
  last_updated_label text,
  source_url text NOT NULL,
  imported_by_account_id uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: 마이그레이션 적용 (development 브랜치)**

Run: `node scripts/run-sql.js sql/021_talent_search_list_import.sql`
Expected: 에러 없이 완료. `.env.local`이 `development` 브랜치를 가리키는지 먼저 확인.

- [ ] **Step 3: extensionToken.js 순수 함수 작성**

```js
// handlers/_lib/extensionToken.js
/**
 * 크롬 확장이 HR 사이트 API를 호출할 때 쓰는 "연결 코드"의 생성·해시
 * 로직. 계정 비밀번호(handlers/_lib/accountAuth.js의 generateTempPassword/
 * hashPassword)와 원칙은 같지만, 이건 사람이 손으로 옮겨 적는 게
 * 아니라 복사-붙여넣기 하는 값이라 가독성보다 엔트로피를 우선해서
 * crypto.randomBytes로 만든다. bcrypt 대신 sha256을 쓰는 이유: API
 * 토큰은 매 요청마다 "이 해시로 계정을 찾아야" 해서(bcrypt.compare처럼
 * 저장된 해시 하나와 1:1 비교가 아니라 DB에서 WHERE token_hash = ? 로
 * 조회) bcrypt의 매 호출 다른 salt 방식이 아니라 결정적(deterministic)
 * 해시가 필요하다.
 */
import crypto from 'node:crypto';

export function generateExtensionToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function hashExtensionToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
```

- [ ] **Step 4: 테스트 작성**

```js
// handlers/_lib/extensionToken.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateExtensionToken, hashExtensionToken } from './extensionToken.js';

test('generateExtensionToken: 48자 hex 문자열을 만든다', () => {
  const token = generateExtensionToken();
  assert.equal(typeof token, 'string');
  assert.equal(token.length, 48);
  assert.match(token, /^[0-9a-f]{48}$/);
});

test('generateExtensionToken: 호출할 때마다 다른 값을 만든다', () => {
  const a = generateExtensionToken();
  const b = generateExtensionToken();
  assert.notEqual(a, b);
});

test('hashExtensionToken: 같은 입력이면 항상 같은 해시', () => {
  const token = 'abc123';
  assert.equal(hashExtensionToken(token), hashExtensionToken(token));
});

test('hashExtensionToken: 다른 입력이면 다른 해시', () => {
  assert.notEqual(hashExtensionToken('abc123'), hashExtensionToken('abc124'));
});

test('hashExtensionToken: 64자 hex(sha256) 문자열을 돌려준다', () => {
  const hash = hashExtensionToken('abc123');
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});
```

- [ ] **Step 5: 테스트 실행**

Run: `node --test handlers/_lib/extensionToken.test.js`
Expected: 5개 테스트 모두 PASS

- [ ] **Step 6: 커밋**

```bash
git add sql/021_talent_search_list_import.sql handlers/_lib/extensionToken.js handlers/_lib/extensionToken.test.js
git commit -m "$(cat <<'EOF'
feat: 인재검색 리스트가져오기용 DB 스키마 + 연결코드 생성/해시 함수 추가

talent_search_extension_tokens(연결 코드), talent_search_list_candidates
(실제 후보 리스트) 테이블 신설 -- 기존 가상후보 테이블과 완전히 별개.
EOF
)"
```

---

### Task 2: 연결 코드 발급 API + requireExtensionToken 인증 헬퍼

**Files:**
- Modify: `handlers/_lib/accountAuth.js`
- Create: `handlers/talent-search-extension-token/index.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: `handlers/_lib/extensionToken.js`의 `generateExtensionToken()`/`hashExtensionToken(token)`(Task 1).
- Produces: `handlers/_lib/accountAuth.js`가 `export async function requireExtensionToken(req, res)`를 추가로 export — `Authorization: Bearer <코드>` 헤더를 검사해서 유효하면 `account` 객체(기존 `requireAuth`가 돌려주는 것과 같은 모양)를, 아니면 응답을 쓰고 `null`을 반환한다. Task 3·4가 이 함수를 그대로 쓴다.

- [ ] **Step 1: requireExtensionToken을 accountAuth.js에 추가**

`handlers/_lib/accountAuth.js` 파일 상단 import에 추가:

```js
import { hashExtensionToken } from './extensionToken.js';
```

파일 맨 아래(`attemptLogin` 함수 뒤)에 추가:

```js
/**
 * 크롬 확장 전용 인증. 쿠키 세션이 아니라 Authorization: Bearer 헤더의
 * 연결 코드로 계정을 찾는다. requireTalentSearchAccess와 마찬가지로
 * ADMIN이거나 can_use_talent_search가 켜진 계정만 통과시킨다 -- 이
 * 기능 전체가 ADMIN 전용이 아니라는 기존 원칙과 동일하게 맞춘다.
 */
export async function requireExtensionToken(req, res) {
  const header = (req.headers && req.headers.authorization) || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) {
    res.status(401).json({ error: '연결 코드가 필요해요' });
    return null;
  }

  const tokenHash = hashExtensionToken(match[1].trim());
  const [tokenRow] = await sql`
    SELECT account_id FROM talent_search_extension_tokens WHERE token_hash = ${tokenHash}`;
  if (!tokenRow) {
    res.status(401).json({ error: '연결 코드가 올바르지 않아요' });
    return null;
  }

  const account = await loadAccountById(tokenRow.account_id);
  if (!account || account.account_status !== 'ACTIVE') {
    res.status(401).json({ error: '연결 코드가 올바르지 않아요' });
    return null;
  }
  if (account.system_role !== 'ADMIN' && !account.can_use_talent_search) {
    res.status(403).json({ error: '인재검색 권한이 없어요' });
    return null;
  }

  await sql`UPDATE talent_search_extension_tokens SET last_used_at = now() WHERE account_id = ${account.id}`;
  return account;
}

/**
 * GET/POST /api/talent-search-extension-token 둘 다에서 쓰는 공용 헬퍼.
 * Authorization 헤더가 있으면 그걸로(확장이 호출하는 경우), 없으면
 * 쿠키 세션으로(HR 사이트 화면에서 호출하는 경우) 인증한다. 두 인증
 * 방식을 동시에 시도하지 않고 헤더 유무로 먼저 분기해서, 쿠키 세션에
 * 실패했다고 401을 쓴 뒤 토큰도 검사하는 이중 응답을 피한다.
 */
export async function requireTalentSearchAccessOrToken(req, res) {
  if (req.headers && req.headers.authorization) {
    return requireExtensionToken(req, res);
  }
  return requireTalentSearchAccess(req, res);
}
```

- [ ] **Step 2: 연결 코드 발급/조회 엔드포인트 작성**

```js
// handlers/talent-search-extension-token/index.js
/**
 * GET  -> 200 { hasToken: boolean, lastUsedAt: string|null }
 * POST -> 200 { token }  (원문 코드, 이 응답에서만 딱 한 번 노출됨)
 *
 * 계정 하나당 연결 코드 하나. POST(재발급)하면 기존 코드는 즉시
 * 무효화된다(UPSERT로 덮어씀) -- 여러 개를 발급해서 관리하는 복잡함을
 * 피하려고 계정 비밀번호 재설정과 같은 "새로 만들면 예전 건 끝"
 * 방식을 그대로 따른다.
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { generateExtensionToken, hashExtensionToken } from '../_lib/extensionToken.js';

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  if (req.method === 'GET') {
    try {
      const [row] = await sql`
        SELECT last_used_at FROM talent_search_extension_tokens WHERE account_id = ${account.id}`;
      return res.status(200).json({ hasToken: !!row, lastUsedAt: row ? row.last_used_at : null });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '연결 코드 상태를 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    try {
      const token = generateExtensionToken();
      const tokenHash = hashExtensionToken(token);
      await sql`
        INSERT INTO talent_search_extension_tokens (account_id, token_hash)
        VALUES (${account.id}, ${tokenHash})
        ON CONFLICT (account_id) DO UPDATE SET token_hash = ${tokenHash}, created_at = now(), last_used_at = NULL`;
      return res.status(200).json({ token });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '연결 코드를 발급하지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 3: api/[...path].js에 등록**

`api/[...path].js` 상단 import 블록에 다른 `talentSearchPolicy*` import들 근처에 추가:

```js
import talentSearchExtensionToken from '../handlers/talent-search-extension-token/index.js';
```

`ROUTES` 배열에 다른 `talent-search-policy` 항목들 근처에 추가:

```js
  { pattern: ['talent-search-extension-token'], handler: talentSearchExtensionToken },
```

- [ ] **Step 4: 로컬 dev 서버로 수동 검증**

1. `node scripts/dev-server.js` 실행(또는 이미 떠 있으면 재사용)
2. `preview-test@selfdiylab.invalid` / `Preview1234`로 로그인한 브라우저에서, 개발자 콘솔로 다음을 실행해서 발급 확인:

```js
fetch('/api/talent-search-extension-token', {method:'POST'}).then(r=>r.json()).then(console.log)
```

3. `{ token: "..." }` 형태 응답이 오는지 확인, 그 토큰 값을 복사해둔다
4. 같은 콘솔에서 방금 받은 토큰으로 헤더 인증이 되는지 확인:

```js
fetch('/api/talent-search-extension-token', {headers:{Authorization:'Bearer ' + '<위에서 받은 토큰>'}}).then(r=>r.json()).then(console.log)
```

5. `{ hasToken: true, lastUsedAt: "..." }`가 오는지 확인(GET은 원래 쿠키세션도 통과하므로, 이 스텝의 핵심은 "틀린 토큰"으로 다시 호출했을 때 401이 오는지 확인하는 것 — 아래 스텝 6 참고)
6. 틀린 토큰으로 확인: `fetch('/api/talent-search-extension-token', {headers:{Authorization:'Bearer wrongtoken'}}).then(r=>console.log(r.status))` → `401` 확인

- [ ] **Step 5: 커밋**

```bash
git add handlers/_lib/accountAuth.js handlers/talent-search-extension-token/index.js "api/[...path].js"
git commit -m "$(cat <<'EOF'
feat: 인재검색 크롬 확장용 연결 코드 발급 API 추가

requireExtensionToken(Bearer 헤더 인증) 헬퍼와
POST/GET /api/talent-search-extension-token 엔드포인트 신설.
EOF
)"
```

---

### Task 3: 리스트 후보 저장/조회 API

**Files:**
- Create: `handlers/_lib/talentSearchListCandidateValidate.js`
- Create: `handlers/_lib/talentSearchListCandidateValidate.test.js`
- Create: `handlers/talent-search-projects/[id]/list-candidates.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: `requireExtensionToken`/`requireTalentSearchAccess`(Task 2, 기존), `talent_search_list_candidates` 테이블(Task 1).
- Produces: `POST /api/talent-search-projects/:id/list-candidates` (확장 전용, `requireExtensionToken`) → `201 { imported: N }`. `GET /api/talent-search-projects/:id/list-candidates` (HR 사이트 화면 전용, `requireTalentSearchAccess`) → `200 { candidates: [{ id, platform, maskedName, gender, age, careerSummary, recentPositions, education, tags, badges, lastUpdatedLabel, sourceUrl, importedAt }] }`. Task 5(화면)와 Task 7(확장)이 이 응답 모양을 그대로 쓴다.

- [ ] **Step 1: 검증 함수 작성 (순수 함수, DB 의존성 없음)**

```js
// handlers/_lib/talentSearchListCandidateValidate.js
/**
 * POST .../list-candidates 요청 바디 검증. db.js를 import하지 않아서
 * DATABASE_URL 없이도 node --test가 돈다(이 프로젝트가 1B-3부터
 * 정착시킨 패턴).
 */
export function validateListCandidateBatch(body) {
  if (!body || typeof body.platform !== 'string' || !body.platform.trim()) {
    return '플랫폼을 지정해주세요';
  }
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return '가져올 후보가 1명 이상 있어야 해요';
  }
  for (const c of body.candidates) {
    if (!c || typeof c.maskedName !== 'string' || !c.maskedName.trim()) {
      return '후보 이름이 올바르지 않아요';
    }
    if (typeof c.sourceUrl !== 'string' || !c.sourceUrl.trim()) {
      return '후보 원문 링크가 올바르지 않아요';
    }
    if (c.age !== undefined && c.age !== null && !Number.isInteger(c.age)) {
      return '나이는 숫자여야 해요';
    }
    if (c.recentPositions !== undefined && !Array.isArray(c.recentPositions)) {
      return '경력 정보 형식이 올바르지 않아요';
    }
    if (c.tags !== undefined && !Array.isArray(c.tags)) {
      return '태그 형식이 올바르지 않아요';
    }
    if (c.badges !== undefined && !Array.isArray(c.badges)) {
      return '배지 형식이 올바르지 않아요';
    }
  }
  return null;
}
```

- [ ] **Step 2: 테스트 작성**

```js
// handlers/_lib/talentSearchListCandidateValidate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateListCandidateBatch } from './talentSearchListCandidateValidate.js';

const validCandidate = {
  maskedName: '김OO',
  sourceUrl: 'https://hiring.saramin.co.kr/applicant-view/position/resume/123',
  age: 27,
  recentPositions: [{ company: 'A사', period: '2년', note: '' }],
  tags: ['영상편집'],
  badges: ['적극 구직중']
};

test('platform 없으면 거부', () => {
  assert.equal(validateListCandidateBatch({ candidates: [validCandidate] }), '플랫폼을 지정해주세요');
});

test('candidates가 빈 배열이면 거부', () => {
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [] }), '가져올 후보가 1명 이상 있어야 해요');
});

test('maskedName 없으면 거부', () => {
  const bad = { ...validCandidate, maskedName: '' };
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [bad] }), '후보 이름이 올바르지 않아요');
});

test('sourceUrl 없으면 거부', () => {
  const bad = { ...validCandidate };
  delete bad.sourceUrl;
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [bad] }), '후보 원문 링크가 올바르지 않아요');
});

test('age가 숫자가 아니면 거부', () => {
  const bad = { ...validCandidate, age: '스물일곱' };
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [bad] }), '나이는 숫자여야 해요');
});

test('정상 입력이면 통과(null)', () => {
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [validCandidate] }), null);
});

test('age/recentPositions/tags/badges는 선택값 -- 없어도 통과', () => {
  const minimal = { maskedName: '김OO', sourceUrl: 'https://x.com/1' };
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [minimal] }), null);
});
```

- [ ] **Step 3: 테스트 실행**

Run: `node --test handlers/_lib/talentSearchListCandidateValidate.test.js`
Expected: 7개 테스트 모두 PASS

- [ ] **Step 4: 저장/조회 엔드포인트 작성**

```js
// handlers/talent-search-projects/[id]/list-candidates.js
/**
 * POST { platform, candidates: [{maskedName,gender?,age?,careerSummary?,
 *        recentPositions?,education?,tags?,badges?,lastUpdatedLabel?,
 *        sourceUrl}] } -> 201 { imported: N }
 *   크롬 확장 전용(requireExtensionToken). 사람인 검색리스트 화면에서
 *   "가져오기"를 누르면 호출된다. 채점을 하지 않으므로 원본 필드
 *   그대로 저장만 한다(이 프로젝트의 "서버는 원본만" 원칙).
 *
 * GET -> 200 { candidates: [...] }  (최신순)
 *   HR 사이트 "검색 진행" 화면 전용(requireTalentSearchAccess).
 */
import { sql } from '../../_lib/db.js';
import { requireExtensionToken, requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { validateListCandidateBatch } from '../../_lib/talentSearchListCandidateValidate.js';

function candidate_out(row) {
  return {
    id: row.id,
    platform: row.platform,
    maskedName: row.masked_name,
    gender: row.gender,
    age: row.age,
    careerSummary: row.career_summary,
    recentPositions: row.recent_positions,
    education: row.education,
    tags: row.tags,
    badges: row.badges,
    lastUpdatedLabel: row.last_updated_label,
    sourceUrl: row.source_url,
    importedAt: row.created_at
  };
}

export default async function handler(req, res) {
  const { id: projectId } = req.query;

  if (req.method === 'POST') {
    const account = await requireExtensionToken(req, res);
    if (!account) return;

    const body = req.body || {};
    const validationError = validateListCandidateBatch(body);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const [project] = await sql`SELECT id FROM talent_search_projects WHERE id = ${projectId}`;
      if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });

      const statements = body.candidates.map(c => sql`
        INSERT INTO talent_search_list_candidates (
          project_id, platform, masked_name, gender, age, career_summary,
          recent_positions, education, tags, badges, last_updated_label,
          source_url, imported_by_account_id
        ) VALUES (
          ${projectId}, ${body.platform}, ${c.maskedName}, ${c.gender || null}, ${c.age ?? null},
          ${c.careerSummary || null}, ${JSON.stringify(c.recentPositions || [])}::jsonb,
          ${c.education || null}, ${JSON.stringify(c.tags || [])}::jsonb,
          ${JSON.stringify(c.badges || [])}::jsonb, ${c.lastUpdatedLabel || null},
          ${c.sourceUrl}, ${account.id}
        )`);
      await sql.transaction(statements);

      return res.status(201).json({ imported: body.candidates.length });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '후보 리스트를 저장하지 못했어요' });
    }
  }

  if (req.method === 'GET') {
    const account = await requireTalentSearchAccess(req, res);
    if (!account) return;

    try {
      const rows = await sql`
        SELECT * FROM talent_search_list_candidates
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC`;
      return res.status(200).json({ candidates: rows.map(candidate_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '후보 리스트를 불러오지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 5: api/[...path].js에 등록**

Import 블록에 추가:

```js
import talentSearchProjectsIdListCandidates from '../handlers/talent-search-projects/[id]/list-candidates.js';
```

`ROUTES` 배열에 다른 `talent-search-projects` 항목들 근처에 추가:

```js
  { pattern: ['talent-search-projects', ':id', 'list-candidates'], handler: talentSearchProjectsIdListCandidates },
```

- [ ] **Step 6: 로컬 dev 서버로 수동 검증**

1. Task 2에서 발급받은 연결 코드와, 실제 존재하는 검색 프로젝트 id(HR 사이트에서 확인하거나 `SELECT id FROM talent_search_projects LIMIT 1`로 조회)를 준비
2. 개발자 콘솔(또는 `curl`)로 저장 확인:

```js
fetch('/api/talent-search-projects/<프로젝트ID>/list-candidates', {
  method: 'POST',
  headers: {'Content-Type':'application/json', 'Authorization':'Bearer <연결코드>'},
  body: JSON.stringify({ platform: '사람인', candidates: [{ maskedName: '김OO', age: 27, sourceUrl: 'https://hiring.saramin.co.kr/applicant-view/position/resume/999' }] })
}).then(r=>r.json()).then(console.log)
```

`{ imported: 1 }` 확인.

3. 쿠키 세션으로(그냥 HR 사이트에 로그인된 브라우저 콘솔에서) 조회 확인:

```js
fetch('/api/talent-search-projects/<프로젝트ID>/list-candidates').then(r=>r.json()).then(console.log)
```

방금 넣은 후보가 보이는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add handlers/_lib/talentSearchListCandidateValidate.js handlers/_lib/talentSearchListCandidateValidate.test.js "handlers/talent-search-projects/[id]/list-candidates.js" "api/[...path].js"
git commit -m "$(cat <<'EOF'
feat: 실제 후보 리스트 저장/조회 API 추가

POST(확장 전용, 연결코드 인증)/GET(HR 사이트 화면 전용, 쿠키세션)
/api/talent-search-projects/:id/list-candidates 신설.
EOF
)"
```

---

### Task 4: 프로젝트 목록 조회에 연결 코드 인증 허용

**Files:**
- Modify: `handlers/talent-search-projects/index.js`

**Interfaces:**
- Consumes: `requireTalentSearchAccessOrToken`(Task 2)

- [ ] **Step 1: GET만 연결 코드도 허용하도록 수정**

`handlers/talent-search-projects/index.js`의 import 줄을 바꾼다:

```js
import { requireTalentSearchAccess, requireTalentSearchAccessOrToken } from '../_lib/accountAuth.js';
```

핸들러 맨 위 인증 부분을 바꾼다 — 기존:

```js
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;
```

새 코드:

```js
  // GET(목록 조회)만 크롬 확장의 연결 코드 인증도 허용한다 -- 확장
  // 팝업이 "어느 프로젝트에 넣을지" 드롭다운을 채울 때 이 엔드포인트를
  // 그대로 재사용하기 위해서다. POST(프로젝트 생성)는 HR 사이트 화면
  // 전용 기능이라 그대로 쿠키 세션만 받는다.
  const account = req.method === 'GET'
    ? await requireTalentSearchAccessOrToken(req, res)
    : await requireTalentSearchAccess(req, res);
  if (!account) return;
```

- [ ] **Step 2: 로컬 dev 서버로 회귀 확인**

1. 기존처럼 HR 사이트에 로그인한 브라우저에서 "인재검색 → 대시보드"가 여전히 프로젝트 목록을 정상적으로 보여주는지 확인(쿠키 세션 경로 안 깨졌는지)
2. 개발자 콘솔에서 연결 코드로도 목록이 조회되는지 확인:

```js
fetch('/api/talent-search-projects', {headers:{Authorization:'Bearer <연결코드>'}}).then(r=>r.json()).then(console.log)
```

`{ projects: [...] }` 확인.

- [ ] **Step 3: 커밋**

```bash
git add handlers/talent-search-projects/index.js
git commit -m "$(cat <<'EOF'
feat: 검색 프로젝트 목록 조회에 크롬 확장 연결코드 인증 허용

GET만 대상 -- POST(생성)는 기존처럼 쿠키 세션 전용으로 유지.
EOF
)"
```

---

### Task 5: HR 사이트 화면 — 연결 코드 발급 + 실제 후보 리스트 표시

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `POST/GET /api/talent-search-extension-token`(Task 2), `GET /api/talent-search-projects/:id/list-candidates`(Task 3).

- [ ] **Step 1: "인재검색" 화면에 "연결" 서브탭 추가**

`index.html`의 428번째 줄 근처(인재검색 뷰 안, 기존 서브탭 버튼들) — 기존:

```html
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
        <button class="tab" onclick="switchTalentSearchTab('versions')" id="tstab-versions">버전 이력</button>
      </div>
```

새 코드(버튼 하나 추가):

```html
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
        <button class="tab" onclick="switchTalentSearchTab('versions')" id="tstab-versions">버전 이력</button>
        <button class="tab" onclick="switchTalentSearchTab('connect')" id="tstab-connect">실행엔진 연결</button>
      </div>
```

같은 파일에서 `<div id="talentsearch-dashboard">`로 시작하는 블록 바로 뒤(그 블록이 끝나는 `</div>` 다음)에 새 컨테이너를 추가한다:

```html
      <div id="talentsearch-connect" style="display:none;">
        <div class="section">
          <div class="section-head"><div><h3>실행엔진(크롬 확장) 연결</h3><div class="desc">크롬 확장이 이 HR 사이트에 후보 리스트를 저장하려면 연결 코드가 필요해요. 발급한 코드를 확장 설정에 붙여넣으면 그 다음부턴 자동으로 인증돼요.</div></div></div>
          <div id="talentsearch-connect-status"></div>
          <button class="btn primary sm" style="margin-top:10px;" onclick="issueTalentSearchExtensionToken()">연결 코드 발급/재발급</button>
          <div id="talentsearch-connect-token" style="margin-top:10px;"></div>
        </div>
      </div>
```

- [ ] **Step 2: switchTalentSearchTab 함수 수정**

`index.html:3063-3071`의 기존 함수:

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

새 코드:

```js
function switchTalentSearchTab(tab){
  ['dashboard','policy','versions','connect'].forEach(t=>{
    document.getElementById('talentsearch-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('tstab-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='dashboard') renderTalentSearchDashboard();
  if(tab==='policy') loadAndRenderTalentSearchPolicy();
  if(tab==='versions') loadAndRenderTalentSearchVersions();
  if(tab==='connect') loadAndRenderTalentSearchConnect();
}
```

- [ ] **Step 3: 연결 코드 발급 화면 로직 추가**

`switchTalentSearchTab` 함수 뒤에 새 함수 추가:

```js
async function loadAndRenderTalentSearchConnect(){
  const statusEl = document.getElementById('talentsearch-connect-status');
  statusEl.textContent = '불러오는 중...';
  try{
    const data = await apiGet('/talent-search-extension-token');
    statusEl.innerHTML = data.hasToken
      ? `연결 코드 발급됨${data.lastUsedAt ? ' · 마지막 사용: ' + new Date(data.lastUsedAt).toLocaleString('ko-KR') : ' · 아직 사용 안 함'}`
      : '아직 연결 코드가 없어요';
  }catch(err){
    statusEl.textContent = '상태를 불러오지 못했어요: ' + err.message;
  }
}

async function issueTalentSearchExtensionToken(){
  if(!confirm('연결 코드를 새로 발급하면 기존 코드는 즉시 무효화돼요. 계속할까요?')) return;
  try{
    const data = await apiPost('/talent-search-extension-token', {});
    document.getElementById('talentsearch-connect-token').innerHTML = `
      <div class="section" style="background:var(--bg-soft,#f5f5f5);">
        <div style="font-weight:600;margin-bottom:6px;">새 연결 코드 (이 화면을 닫으면 다시 볼 수 없어요)</div>
        <div style="font-family:monospace;font-size:14px;word-break:break-all;user-select:all;">${escapeHtml(data.token)}</div>
        <div class="desc" style="margin-top:6px;">이 코드를 복사해서 크롬 확장의 설정에 붙여넣으세요.</div>
      </div>
    `;
    loadAndRenderTalentSearchConnect();
  }catch(err){
    alert('연결 코드 발급에 실패했어요: ' + err.message);
  }
}
```

- [ ] **Step 4: "검색 진행" 화면에 실제 후보 리스트 섹션 추가**

`index.html:3800-3873`의 `renderTalentSearchCandidatesScreen` 함수는 그대로 두고(가상 후보 렌더링, 손대지 않음), 그 함수의 마지막 부분(테이블을 담은 `</div>`)과 함수를 닫는 `}` 사이, 즉 3871번째 줄(`</div>`) 바로 뒤에 새 섹션을 추가한다:

```js
  el.innerHTML = `
    ${backBtn}
    <div class="section">
      ...(기존 가상후보 KPI/버튼, 변경 없음)
    </div>
    <div class="section">
      ...(기존 가상후보 표, 변경 없음)
    </div>
    <div class="section" id="talentsearch-list-candidates-section">
      <div class="section-head"><div><h3>실제 후보 리스트</h3><div class="desc">사람인 검색결과에서 크롬 확장으로 가져온 후보예요. 채점은 아직 안 하고, 정렬·필터만 돼요. 행을 클릭하면 원문 이력서로 이동해요.</div></div></div>
      <div id="talentsearch-list-candidates-body">불러오는 중...</div>
    </div>
  `;
  loadTalentSearchListCandidates(projectId);
}
```

(주의: 위 코드 블록의 `...(기존 가상후보 ...)` 부분은 실제로 지우지 말고 원래 있던 코드를 그대로 둔 채로, `el.innerHTML` 템플릿 리터럴 안에 새 `<div class="section" id="talentsearch-list-candidates-section">...</div>` 블록만 기존 두 번째 `</div>` 뒤·백틱(`` ` ``) 앞에 추가하고, 함수 마지막 줄(`}` 직전)에 `loadTalentSearchListCandidates(projectId);` 호출을 추가하라는 뜻이다.)

`renderTalentSearchCandidatesScreen` 함수 뒤에 새 함수 두 개 추가:

```js
function tsListCandidateRowHtml(c){
  const tags = (c.tags||[]).join(', ');
  return `
    <tr class="clickable" onclick="window.open('${c.sourceUrl}', '_blank')">
      <td>${escapeHtml(c.maskedName)}</td>
      <td>${escapeHtml(c.gender||'-')}</td>
      <td>${c.age ?? '-'}</td>
      <td>${escapeHtml(c.careerSummary||'-')}</td>
      <td>${escapeHtml(c.education||'-')}</td>
      <td>${escapeHtml(tags||'-')}</td>
      <td>${escapeHtml(c.lastUpdatedLabel||'-')}</td>
    </tr>
  `;
}

async function loadTalentSearchListCandidates(projectId){
  const bodyEl = document.getElementById('talentsearch-list-candidates-body');
  if(!bodyEl) return;
  try{
    const { candidates } = await apiGet(`/talent-search-projects/${projectId}/list-candidates`);
    if(!candidates.length){
      bodyEl.innerHTML = '<div class="empty">아직 가져온 후보가 없어요. 크롬 확장에서 사람인 검색결과를 가져와보세요.</div>';
      return;
    }
    bodyEl.innerHTML = `
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>이름</th><th>성별</th><th>나이</th><th>경력</th><th>학력</th><th>태그</th><th>최종업데이트</th></tr></thead>
        <tbody>${candidates.map(tsListCandidateRowHtml).join('')}</tbody>
      </table>
      </div>
    `;
  }catch(err){
    bodyEl.innerHTML = `<div class="empty">불러오지 못했어요: ${escapeHtml(err.message)}</div>`;
  }
}
```

- [ ] **Step 5: 로컬 dev 서버로 수동 검증**

1. `preview-test@selfdiylab.invalid`로 로그인 → "인재검색" → "실행엔진 연결" 탭 클릭 → "연결 코드 발급/재발급" 클릭 → 코드가 화면에 뜨는지 확인, 다시 탭을 벗어났다 돌아오면 "발급됨"으로만 보이고 원문은 안 보이는지 확인
2. Task 3 Step 6에서 이미 API로 넣어둔 테스트 후보가 있다면, 그 프로젝트의 "검색 진행" 화면을 열어서 "실제 후보 리스트" 섹션에 표로 보이는지 확인
3. 행 클릭 시 `source_url`이 새 탭으로 열리는지 확인

- [ ] **Step 6: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: HR 사이트에 연결 코드 발급 화면 + 실제 후보 리스트 표시 추가

인재검색 화면에 "실행엔진 연결" 서브탭 신설, "검색 진행" 화면에
실제 후보 리스트 섹션 추가(가상 후보 렌더링은 변경 없음).
EOF
)"
```

---

### Task 6: 크롬 확장 — 검색리스트 페이지 파싱

**Files:**
- Modify: `chrome-extension/manifest.json`
- Create: `chrome-extension/list-content-lib.js`
- Create: `chrome-extension/list-content-lib.test.js`
- Create: `chrome-extension/list-content.js`

**Interfaces:**
- Produces: `list-content-lib.js`가 `export function parseCandidateCard(cardElement)`(카드 하나 → `{maskedName,gender,age,careerSummary,recentPositions,education,tags,badges,lastUpdatedLabel,sourceUrl}` 객체, DOM 요소를 인자로 받는 순수 함수에 가깝게 설계 — 실제로는 `Element`를 받으므로 완전한 순수함수는 아니지만 브라우저 전역 API(`chrome.*`, `fetch` 등)에는 의존하지 않아 jsdom으로 테스트 가능)를 export. `list-content.js`가 이 함수를 각 카드에 적용해서 배열을 만들고, `chrome.runtime.onMessage`로 `{type:'PARSE_CURRENT_LIST'}`를 받으면 `{candidates: [...]}`로 응답한다. Task 7(팝업)이 이 메시지 계약을 그대로 쓴다.

이 프로젝트는 `jsdom`을 이미 의존성으로 갖고 있다(`package.json` 확인 — DB 관련 다른 곳에서 이미 쓰는 중일 수 있음, 없다면 `npm install --save-dev jsdom`은 필요 없음 — devDependencies 없이 dependencies에 이미 있으므로 그대로 import 가능).

- [ ] **Step 1: 실제 사람인 검색결과 리스트 페이지의 DOM 구조를 먼저 확인한다**

이 태스크를 시작하기 전에 반드시 실제 페이지를 열어서 확인해야 한다 — 아래 스텝의 선택자는 확정된 게 아니라 시작점이다. 로컬 개발 환경에서 사용 가능한 브라우저 도구로:

1. 사람인에 로그인된 상태로 `https://www.saramin.co.kr/zf_user/memcom/talent-pool/main/search`(또는 이미 검색해둔 결과 화면)를 연다
2. 후보 카드 하나를 살펴보고(개발자도구로 Elements 탭 확인), 다음 정보가 각각 어떤 HTML 태그/클래스/텍스트 패턴으로 나오는지 정확히 기록한다: 후보 카드 전체를 감싸는 반복 요소(리스트 안에서 카드 하나하나를 가리키는 selector), 마스킹된 이름, 성별/나이, 경력 요약, 최근 직장 이력(회사명+기간+메모, 여러 개일 수 있음), 학력, 스킬 태그들, 특징 배지들, 최종 업데이트 날짜 문구, 그리고 카드를 클릭했을 때 실제로 이동하는 상세 페이지 URL을 어떻게 알아낼 수 있는지(카드 자체의 `href`가 `javascript:void(0)`이면, `data-*` 속성이나 `onclick` 핸들러 안에 후보 ID가 있는지 확인 — 오늘 상세 페이지 URL 패턴이 `https://hiring.saramin.co.kr/applicant-view/position/resume/<숫자ID>`였다는 걸 참고해서, 그 숫자 ID를 카드에서 뽑아낼 방법을 찾는다)
3. 확인한 실제 선택자로 아래 `parseCandidateCard`를 작성한다. 아래 코드는 그 확인 전에 작성된 합리적인 추정 뼈대이니, 실제 구조와 다르면 선택자 부분만 고치고 함수 시그니처(인자/반환값 모양)는 유지한다.

- [ ] **Step 2: list-content-lib.js 작성 (실제 확인한 선택자로)**

```js
// chrome-extension/list-content-lib.js
/**
 * 사람인 검색결과 리스트 페이지의 후보 카드 하나를 파싱한다. DOM
 * Element를 인자로 받지만 chrome.* API나 네트워크 요청에는 의존하지
 * 않아서, jsdom으로 만든 요소를 넣어 node --test로 검증할 수 있다.
 *
 * 선택자는 2026-08-27 실사용 확인 기준 -- 사람인이 화면 구조를 바꾸면
 * 깨질 수 있다. 필드를 못 찾으면 추측하지 않고 null/빈 배열로 둔다
 * (이 프로젝트의 fail-closed 원칙 -- 잘못된 값을 지어내지 않는다).
 */
export function parseCandidateCard(cardElement) {
  const text = (selector) => {
    const found = cardElement.querySelector(selector);
    return found ? found.textContent.trim() : null;
  };
  const textAll = (selector) => Array.from(cardElement.querySelectorAll(selector)).map(el => el.textContent.trim());

  return {
    maskedName: text('[data-field="name"]') || null,
    gender: text('[data-field="gender"]') || null,
    age: (() => {
      const raw = text('[data-field="age"]');
      const match = raw ? /(\d+)/.exec(raw) : null;
      return match ? Number(match[1]) : null;
    })(),
    careerSummary: text('[data-field="career-summary"]') || null,
    recentPositions: Array.from(cardElement.querySelectorAll('[data-field="position"]')).map(el => ({
      company: (el.querySelector('[data-field="company"]') || {}).textContent?.trim() || '',
      period: (el.querySelector('[data-field="period"]') || {}).textContent?.trim() || '',
      note: (el.querySelector('[data-field="note"]') || {}).textContent?.trim() || ''
    })),
    education: text('[data-field="education"]') || null,
    tags: textAll('[data-field="tag"]'),
    badges: textAll('[data-field="badge"]'),
    lastUpdatedLabel: text('[data-field="updated"]') || null,
    sourceUrl: cardElement.dataset.resumeUrl || null
  };
}
```

- [ ] **Step 3: 테스트 작성 (jsdom으로 가짜 카드 HTML 구성)**

```js
// chrome-extension/list-content-lib.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseCandidateCard } from './list-content-lib.js';

function cardFromHtml(html) {
  const dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
  return dom.window.document.querySelector('#root > *');
}

test('parseCandidateCard: 필드가 다 있는 카드를 정확히 파싱한다', () => {
  const card = cardFromHtml(`
    <div data-resume-url="https://hiring.saramin.co.kr/applicant-view/position/resume/12345">
      <span data-field="name">김OO</span>
      <span data-field="gender">여</span>
      <span data-field="age">27세</span>
      <span data-field="career-summary">경력 5년 3개월</span>
      <div data-field="position">
        <span data-field="company">A사</span>
        <span data-field="period">11개월</span>
        <span data-field="note">마케팅</span>
      </div>
      <span data-field="education">영산대학교(부산)</span>
      <span data-field="tag">영상편집</span>
      <span data-field="tag">유튜브</span>
      <span data-field="badge">적극 구직중</span>
      <span data-field="updated">26-06-10 업데이트</span>
    </div>
  `);
  const result = parseCandidateCard(card);
  assert.equal(result.maskedName, '김OO');
  assert.equal(result.gender, '여');
  assert.equal(result.age, 27);
  assert.equal(result.careerSummary, '경력 5년 3개월');
  assert.deepEqual(result.recentPositions, [{ company: 'A사', period: '11개월', note: '마케팅' }]);
  assert.equal(result.education, '영산대학교(부산)');
  assert.deepEqual(result.tags, ['영상편집', '유튜브']);
  assert.deepEqual(result.badges, ['적극 구직중']);
  assert.equal(result.lastUpdatedLabel, '26-06-10 업데이트');
  assert.equal(result.sourceUrl, 'https://hiring.saramin.co.kr/applicant-view/position/resume/12345');
});

test('parseCandidateCard: 필드가 없으면 null/빈 배열로 채운다(추측하지 않음)', () => {
  const card = cardFromHtml('<div></div>');
  const result = parseCandidateCard(card);
  assert.equal(result.maskedName, null);
  assert.equal(result.age, null);
  assert.deepEqual(result.recentPositions, []);
  assert.deepEqual(result.tags, []);
  assert.equal(result.sourceUrl, null);
});

test('parseCandidateCard: 나이 텍스트에서 숫자만 뽑아낸다', () => {
  const card = cardFromHtml('<div><span data-field="age">여, 27세</span></div>');
  assert.equal(parseCandidateCard(card).age, 27);
});
```

- [ ] **Step 4: 테스트 실행**

Run: `node --test chrome-extension/list-content-lib.test.js`
Expected: 3개 테스트 모두 PASS

(주의: 위 테스트는 Step 2의 추정 선택자(`data-field="..."`) 기준으로 작성됐다. Step 1에서 확인한 실제 선택자가 다르면, Step 2의 구현과 이 테스트의 fixture HTML을 실제 선택자에 맞게 같이 고쳐야 한다 — 함수 시그니처와 반환값 모양(camelCase 필드명)은 그대로 유지한다.)

- [ ] **Step 5: manifest.json에 검색리스트 페이지 콘텐츠 스크립트 등록**

`chrome-extension/manifest.json`의 `host_permissions`에 검색리스트 도메인 추가:

```json
  "host_permissions": [
    "https://hiring.saramin.co.kr/*",
    "https://www.saramin.co.kr/zf_user/memcom/talent-pool/*",
    "http://localhost:3000/*"
  ],
```

`content_scripts` 배열에 새 항목 추가:

```json
  "content_scripts": [
    {
      "matches": ["https://hiring.saramin.co.kr/applicant-view/*"],
      "js": ["content.js"]
    },
    {
      "matches": ["https://www.saramin.co.kr/zf_user/memcom/talent-pool/*"],
      "js": ["list-content.js"]
    }
  ],
```

`web_accessible_resources`에 `list-content-lib.js`도 추가(동적 import용, 기존 파일과 같은 이유):

```json
  "web_accessible_resources": [{
    "resources": ["content-lib.js", "ocr-lib.js", "list-content-lib.js"],
    "matches": ["https://hiring.saramin.co.kr/*", "https://www.saramin.co.kr/*"]
  }]
```

- [ ] **Step 6: list-content.js 작성**

```js
// chrome-extension/list-content.js
// 사람인 검색결과 리스트 페이지에 주입된다. 팝업의 "이 페이지
// 가져오기" 클릭을 받으면(PARSE_CURRENT_LIST) 현재 화면에 보이는
// 후보 카드들을 파싱해서 돌려준다. 페이지를 스크롤하거나 다음
// 페이지로 넘기지 않는다 -- "지금 보이는 페이지만" 가져오는 게
// 이번 슬라이스의 의도된 범위다.

let libPromise = null;
function getLib() {
  if (!libPromise) {
    libPromise = import(chrome.runtime.getURL('list-content-lib.js'));
  }
  return libPromise;
}

// 실제 후보 카드를 감싸는 반복 요소의 선택자. Task 6 Step 1에서 확인한
// 값으로 바꿔야 한다 -- 이 자리표시자 선택자는 실제 페이지 구조를
// 확인하기 전에 작성된 것이라 그대로 두면 동작하지 않는다.
const CANDIDATE_CARD_SELECTOR = '[data-testid="candidate-card"]';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'PARSE_CURRENT_LIST') return false;

  (async () => {
    const { parseCandidateCard } = await getLib();
    const cards = Array.from(document.querySelectorAll(CANDIDATE_CARD_SELECTOR));
    const candidates = cards.map(parseCandidateCard).filter(c => c.maskedName && c.sourceUrl);
    sendResponse({ candidates });
  })();

  return true; // 비동기 응답을 위해 채널을 열어둔다
});
```

- [ ] **Step 7: 커밋**

```bash
git add chrome-extension/manifest.json chrome-extension/list-content-lib.js chrome-extension/list-content-lib.test.js chrome-extension/list-content.js
git commit -m "$(cat <<'EOF'
feat: 크롬 확장에 사람인 검색리스트 페이지 파싱 기능 추가

list-content.js가 현재 화면의 후보 카드들을 파싱해서 돌려준다(한
페이지만, 자동 스크롤/페이지넘김 없음). 실제 DOM 선택자는 구현 중
라이브 페이지 확인 후 확정 필요.
EOF
)"
```

---

### Task 7: 크롬 확장 — 팝업 UI (연결 코드 설정, 프로젝트 선택, 가져오기)

**Files:**
- Modify: `chrome-extension/popup.html`
- Modify: `chrome-extension/popup.js`
- Modify: `chrome-extension/background.js`

**Interfaces:**
- Consumes: `list-content.js`의 `{type:'PARSE_CURRENT_LIST'}` → `{candidates}` 메시지 계약(Task 6), `GET /api/talent-search-projects`(연결 코드 인증, Task 4), `POST /api/talent-search-projects/:id/list-candidates`(연결 코드 인증, Task 3).

- [ ] **Step 1: popup.html에 연결 코드 설정 + 가져오기 UI 추가**

기존 `chrome-extension/popup.html`의 `<body>` 안, `<button id="extractBtn">` 앞에 새 섹션 추가:

```html
  <div id="tokenSetup" style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #ddd;">
    <div style="font-size:12px;color:#555;margin-bottom:4px;">HR 사이트 연결 코드</div>
    <input id="tokenInput" type="text" placeholder="연결 코드 붙여넣기" style="width:100%;box-sizing:border-box;padding:4px;">
    <button id="tokenSaveBtn" style="margin-top:4px;">저장</button>
    <div id="tokenStatus" style="font-size:11px;color:#555;margin-top:4px;"></div>
  </div>
  <div id="listImportSection" style="display:none;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #ddd;">
    <div style="font-size:12px;color:#555;margin-bottom:4px;">가져올 검색 프로젝트</div>
    <select id="projectSelect" style="width:100%;"></select>
    <button id="importBtn" style="margin-top:8px;">이 페이지 가져오기</button>
    <div id="importStatus" style="font-size:11px;color:#555;margin-top:4px;"></div>
  </div>
```

- [ ] **Step 2: popup.js에 연결 코드 저장 로직 추가**

`chrome-extension/popup.js` 맨 위(기존 `const btn = ...` 줄들 앞)에 추가:

```js
const HR_SITE_ORIGIN = 'http://localhost:3000'; // 로컬 개발용. 배포 시 별도로 바꿔야 함(이번 계획 범위 밖).

const tokenInput = document.getElementById('tokenInput');
const tokenSaveBtn = document.getElementById('tokenSaveBtn');
const tokenStatus = document.getElementById('tokenStatus');

async function loadSavedToken() {
  const { extensionToken } = await chrome.storage.local.get('extensionToken');
  return extensionToken || null;
}

tokenSaveBtn.addEventListener('click', async () => {
  const value = tokenInput.value.trim();
  if (!value) return;
  await chrome.storage.local.set({ extensionToken: value });
  tokenInput.value = '';
  tokenStatus.textContent = '저장됨';
  await initListImportUiIfApplicable();
});
```

- [ ] **Step 3: 검색리스트 페이지에서만 가져오기 UI를 보여주는 로직 추가**

같은 파일에 추가:

```js
const listImportSection = document.getElementById('listImportSection');
const projectSelect = document.getElementById('projectSelect');
const importBtn = document.getElementById('importBtn');
const importStatus = document.getElementById('importStatus');

async function initListImportUiIfApplicable() {
  const token = await loadSavedToken();
  tokenStatus.textContent = token ? '연결 코드 저장됨' : '연결 코드를 입력해주세요';
  if (!token) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isListPage = tab.url && tab.url.includes('/zf_user/memcom/talent-pool/');
  if (!isListPage) return;

  listImportSection.style.display = '';
  try {
    const res = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      importStatus.textContent = data.error || '프로젝트 목록을 불러오지 못했어요';
      return;
    }
    projectSelect.innerHTML = data.projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
  } catch (err) {
    importStatus.textContent = `프로젝트 목록 오류: ${err.message}`;
  }
}

importBtn.addEventListener('click', async () => {
  const token = await loadSavedToken();
  const projectId = projectSelect.value;
  if (!token || !projectId) return;

  importStatus.textContent = '가져오는 중...';
  importBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parseResult = await chrome.tabs.sendMessage(tab.id, { type: 'PARSE_CURRENT_LIST' });
    const candidates = (parseResult && parseResult.candidates) || [];
    if (!candidates.length) {
      importStatus.textContent = '가져올 후보를 찾지 못했어요';
      return;
    }

    const res = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects/${projectId}/list-candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform: '사람인', candidates })
    });
    const data = await res.json();
    importStatus.textContent = res.ok ? `${data.imported}명 가져왔어요` : (data.error || '가져오기 실패');
  } catch (err) {
    importStatus.textContent = `오류: ${err.message}`;
  } finally {
    importBtn.disabled = false;
  }
});

initListImportUiIfApplicable();
```

- [ ] **Step 4: background.js는 변경 없음 확인**

이 태스크는 `background.js`를 수정하지 않는다 — 팝업이 HR 사이트 API를 직접 `fetch`로 호출하고(확장 팝업도 `fetch`를 쓸 수 있는 컨텍스트다), `list-content.js`와는 `chrome.tabs.sendMessage`로 직접 통신하므로 캡처+OCR 릴레이(background.js의 기존 역할)가 필요 없다. 다만 Files 목록에 `background.js`가 있었던 건 애초 설계 검토 중 필요할 수도 있다고 생각했던 항목인데, 실제로 구현해보니 필요 없다는 걸 이 스텝에서 확인차 명시한다 — 손대지 않고 넘어간다.

- [ ] **Step 5: 확장 리로드 후 전체 흐름 수동 검증**

1. `chrome://extensions`에서 확장 새로고침
2. 아무 페이지에서나 팝업 열기 → "연결 코드" 입력칸에 Task 2에서 발급받은 코드 붙여넣고 "저장" → "연결 코드 저장됨" 표시 확인
3. 사람인 검색결과 리스트 화면으로 이동 → 팝업 다시 열기 → "가져올 검색 프로젝트" 드롭다운에 실제 프로젝트 목록이 뜨는지 확인
4. 프로젝트 선택 → "이 페이지 가져오기" 클릭 → "N명 가져왔어요" 뜨는지 확인
5. HR 사이트의 해당 프로젝트 "검색 진행" 화면을 새로고침 → "실제 후보 리스트" 섹션에 방금 가져온 후보들이 표로 보이는지 확인
6. 행 하나 클릭 → 사람인 원문 이력서 페이지가 새 탭으로 열리는지 확인

- [ ] **Step 6: 커밋**

```bash
git add chrome-extension/popup.html chrome-extension/popup.js
git commit -m "$(cat <<'EOF'
feat: 크롬 확장 팝업에 연결 코드 설정 + 리스트 가져오기 UI 추가

검색리스트 페이지에서만 프로젝트 선택+가져오기 UI가 뜨고, 상세
이력서 페이지에서는 기존 OCR 추출 UI가 그대로 뜬다.
EOF
)"
```

---

## Self-Review 메모 (계획 작성자가 직접 확인함)

- **스펙 커버리지**: 설계 문서의 "아키텍처"(확장→연결코드→API→DB) → Task 1~4. "크롬 확장 변경사항"(연결 코드 입력, 프로젝트 선택, 파싱, 전송) → Task 6~7. "HR 웹사이트 화면 변경사항"(연결 코드 발급 화면, 실제 후보 리스트 탭) → Task 5. "안전장치"(검색은 대신 안 함, 한 페이지만, 로그인 화면 감지는 기존 것 재사용, 연결 코드는 비밀번호 수준 취급) → Task 6(한 페이지만, 자동 스크롤 없음), Task 1~2(코드 해시 저장). "테스트" 절 항목들 → 각 태스크의 Step에 반영.
- **플레이스홀더 스캔**: "TODO"/"나중에" 없음. Task 6의 DOM 선택자만 "실사용 확인 후 확정 필요"라고 명시적으로 표시했는데, 이건 미루는 게 아니라 이 프로젝트가 이미 여러 번 써온 정직한 패턴이다(오늘 오전 상세 페이지 작업도 동일 -- 라이브 페이지 없이 선택자를 지어내지 않는다).
- **타입/시그니처 일관성**: `parseCandidateCard(cardElement)` 반환 모양(camelCase 필드) ↔ Task 6 list-content.js가 그대로 배열로 씀 ↔ Task 3의 `validateListCandidateBatch`가 기대하는 바디 모양(`maskedName`,`sourceUrl` 등) ↔ Task 7 popup.js가 그 candidates 배열을 그대로 POST 바디에 넣음 — 전부 같은 필드명 확인함. `requireExtensionToken`/`requireTalentSearchAccessOrToken`(Task 2 정의) ↔ Task 3·4가 import해서 쓰는 이름 일치 확인함.
- **범위 확인**: 자동 채점, 여러 페이지 자동 순회, 중복 처리, 타 플랫폼 — 어떤 태스크에도 없음(설계 문서의 "제외" 목록과 일치). 기존 가상 후보 코드(`talent_search_candidates` 테이블, `candidates.js` 핸들러, `renderTalentSearchCandidatesScreen`의 가상후보 렌더링 부분)는 Task 5에서 "변경 없음"으로 명시하고 실제로 어떤 Step도 그 코드를 수정하지 않음.
