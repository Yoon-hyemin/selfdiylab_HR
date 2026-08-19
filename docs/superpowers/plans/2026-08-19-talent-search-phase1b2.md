# 인재검색 Phase 1B-2 (Level1 + 공통 40점 수정 가능) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "기준 관리센터"에서 Level 1 문턱값과 공통 적합도 40점 배점을 실제로 수정할 수 있게 만든다 — 수정하면 즉시 새 정책 버전이 생성되어 바로 적용된다. 공통 40점 항목은 개수 제한 없이 자유롭게 추가/삭제할 수 있다(합계는 항상 정확히 40).

**Architecture:** 기존 패턴 그대로 — `handlers/_lib/talentSearchPolicy.js`에 "현재 활성 버전 조회 + 필드 일부만 바꿔 새 버전 생성" 공용 로직을 두고, 두 개의 얇은 PATCH 핸들러가 각자 자기 필드만 검증한 뒤 이 공용 로직을 호출한다. 프론트는 기존 읽기전용 카드 아래 "수정" 버튼을 추가해 모달을 띄우고, 저장되면 화면을 다시 불러온다.

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`(`sql.transaction`), 순수 SQL.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-19-talent-search-phase1b2-policy-editing-design.md` — 정확한 검증 규칙·API 모양은 이 문서에서 그대로 가져온다.
- 수정 = 새 버전 즉시 생성+적용(초안 없음). 기존 활성 버전은 `status='superseded'`로, 새 행은 `version_no = 기존+1`, `status='active'`로 INSERT.
- 두 PATCH 엔드포인트 모두 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님, Phase 1B-1과 동일).
- `sql.transaction([stmt1, stmt2])`는 각 statement의 결과 배열을 담은 배열을 반환한다(`[rows1, rows2]`) — 직접 확인됨. `RETURNING *`이 있는 두 번째 statement의 결과는 `result[1][0]`으로 꺼낸다.
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에도 반드시 등록한다.
- 공통 40점 항목: 개수 자유(최소 1개), `key`는 항목 정체성을 유지하기 위한 값(라벨이 바뀌어도 유지), 배열 안에서 서로 중복되면 안 됨. 새 항목의 `key`는 프론트에서 자동 생성(사람이 영문 key를 직접 입력할 필요 없음).
- 이 프로젝트는 순수 계산 로직만 `node --test`로 단위테스트하고, DB/HTTP/UI 통합 작업은 로컬 dev 서버 브라우저 수동 검증으로 확인한다. 단, 이번 Task 1~3에는 **검증 함수(validateLevel1Rules/validateCommonFitWeights)라는 순수 로직**이 새로 생기므로, 이 부분은 예외적으로 `node --test` 단위테스트를 추가한다(이 프로젝트에서 검증 로직에 단위테스트를 쓴 유일한 전례는 없지만, `handlers/_lib/kpiCalc.test.js`가 "순수 계산은 테스트, DB/HTTP는 수동" 원칙의 근거이므로 그 원칙을 그대로 따른 것 — 검증 함수는 DB/HTTP 없이 입력→출력만 있는 순수 함수라 이 원칙에 정확히 부합한다).
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖.

---

### Task 1: 공유 헬퍼 `handlers/_lib/talentSearchPolicy.js` + GET 핸들러 리팩터

**Files:**
- Create: `handlers/_lib/talentSearchPolicy.js`
- Modify: `handlers/talent-search-policy/index.js`

**Interfaces:**
- Produces: `export function policy_out(row)`, `export async function getActivePolicy()`, `export async function createPolicyVersion(current, overrides, actorAccountId, changeReason)` — Task 2/3이 이 세 함수를 `../_lib/talentSearchPolicy.js`에서 import한다. `createPolicyVersion`은 새로 활성화된 정책 row(snake_case, DB 원본)를 반환한다 — 호출부가 `policy_out()`으로 감싼다.

- [ ] **Step 1: 공유 헬퍼 파일 작성**

```js
/**
 * handlers/_lib/talentSearchPolicy.js
 *
 * 인재검색 채점 정책(talent_search_policy_versions) 공용 헬퍼. GET 핸들러와
 * 여러 PATCH 핸들러(Level1/공통40점, 이후 1B-3에서 직무60점/임계값도 추가될
 * 예정)가 전부 "현재 활성 버전 읽기"와 "필드 일부만 바꿔 새 버전 만들기"를
 * 반복하므로 여기 한 곳에 모은다.
 *
 * 수정 = 새 버전을 만들어 바로 적용(초안 단계 없음, 1B-4에서 추가 예정)하는
 * 방식이라, createPolicyVersion은 "기존 활성 버전을 supersede하고 새 활성
 * 버전을 insert"하는 트랜잭션 하나로 끝난다.
 */
import { sql } from './db.js';

export function policy_out(row) {
  return {
    versionNo: row.version_no,
    level1Rules: row.level1_rules,
    commonFitWeights: row.common_fit_weights,
    evidenceCoefficients: row.evidence_coefficients,
    jobFitDefaultWeights: row.job_fit_default_weights,
    roundingRule: row.rounding_rule,
    thresholds: row.thresholds,
    sortTiebreakRules: row.sort_tiebreak_rules,
    dailyRecommendCapDefault: row.daily_recommend_cap_default,
    dailyRecommendCapAbsoluteMax: row.daily_recommend_cap_absolute_max,
    dataRetentionMonths: row.data_retention_months,
    status: row.status,
    changeReason: row.change_reason,
    appliedAt: row.applied_at,
    createdAt: row.created_at
  };
}

export async function getActivePolicy() {
  const [row] = await sql`
    SELECT * FROM talent_search_policy_versions WHERE status = 'active'
    ORDER BY version_no DESC LIMIT 1`;
  return row || null;
}

// current: getActivePolicy()가 반환한 현재 활성 버전 row(snake_case 그대로).
// overrides: 바뀌는 필드만 snake_case 키로 담은 객체(예: { level1_rules: {...} }).
// 나머지 필드는 current 값을 그대로 복사해서 새 버전에 들어간다.
export async function createPolicyVersion(current, overrides, actorAccountId, changeReason) {
  const next = { ...current, ...overrides };
  const nextVersionNo = current.version_no + 1;
  const result = await sql.transaction([
    sql`UPDATE talent_search_policy_versions SET status = 'superseded' WHERE id = ${current.id}`,
    sql`INSERT INTO talent_search_policy_versions (
      version_no, level1_rules, common_fit_weights, evidence_coefficients,
      job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
      daily_recommend_cap_default, daily_recommend_cap_absolute_max,
      data_retention_months, status, change_reason, created_by, applied_at
    ) VALUES (
      ${nextVersionNo}, ${JSON.stringify(next.level1_rules)}::jsonb,
      ${JSON.stringify(next.common_fit_weights)}::jsonb, ${JSON.stringify(next.evidence_coefficients)}::jsonb,
      ${JSON.stringify(next.job_fit_default_weights)}::jsonb, ${JSON.stringify(next.rounding_rule)}::jsonb,
      ${JSON.stringify(next.thresholds)}::jsonb, ${JSON.stringify(next.sort_tiebreak_rules)}::jsonb,
      ${next.daily_recommend_cap_default}, ${next.daily_recommend_cap_absolute_max},
      ${next.data_retention_months}, 'active', ${changeReason}, ${actorAccountId}, now()
    ) RETURNING *`
  ]);
  return result[1][0];
}
```

- [ ] **Step 2: GET 핸들러가 공유 헬퍼를 쓰도록 리팩터**

`handlers/talent-search-policy/index.js`를 아래로 교체(로직은 동일, `policy_out`/조회 쿼리만 공유 헬퍼로 이동):

```js
/**
 * handlers/talent-search-policy/index.js
 *
 * GET -> 200 { versionNo, level1Rules, commonFitWeights, evidenceCoefficients,
 *              jobFitDefaultWeights, roundingRule, thresholds, sortTiebreakRules,
 *              dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax,
 *              dataRetentionMonths, status, changeReason, appliedAt, createdAt }
 *
 * 지금 적용 중인(status='active') 인재검색 채점 정책 하나를 반환한다.
 * 수정(PATCH)은 talent-search-policy/level1-rules.js, common-fit-weights.js
 * 등 별도 파일에 있다 -- 필드별로 독립적인 수정 흐름/검증을 갖기 때문.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, policy_out } from '../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const policy = await getActivePolicy();
    if (!policy) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    return res.status(200).json(policy_out(policy));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준을 불러오지 못했어요' });
  }
}
```

- [ ] **Step 3: 수동 확인 — 기존 동작 안 깨졌는지**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), 기존 ADMIN 테스트 계정(`preview-test@selfdiylab.invalid`/`Preview1234`)으로 로그인한 쿠키로:
```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: 이전과 동일하게 `{"versionNo":1,...}` 응답 (리팩터로 동작이 바뀌지 않았음을 확인)

- [ ] **Step 4: Commit**

```bash
git add "handlers/_lib/talentSearchPolicy.js" "handlers/talent-search-policy/index.js"
git commit -m "refactor: 인재검색 정책 조회/버전생성 공유 헬퍼 handlers/_lib/talentSearchPolicy.js로 분리"
```

---

### Task 2: `PATCH /api/talent-search-policy/level1-rules`

**Files:**
- Create: `handlers/talent-search-policy/level1-rules.js`
- Test: `handlers/talent-search-policy/level1-rules.test.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 `getActivePolicy`/`createPolicyVersion`/`policy_out`, 기존 `requireTalentSearchAccess`
- Produces: `PATCH /api/talent-search-policy/level1-rules` `{ level1Rules, changeReason }` → `200 { ...policy_out 응답, versionNo가 +1됨 }`. `export function validateLevel1Rules(l1)`(파일 내부, 테스트가 직접 import) — 통과하면 `null`, 실패하면 한국어 에러 문자열 반환.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// handlers/talent-search-policy/level1-rules.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLevel1Rules } from './level1-rules.js';

const VALID = {
  resumeUpdated: { passWithinDays: 90, verifyWithinDays: 180 },
  shortTenure: { monthsThreshold: 12, lookbackYears: 5, countThreshold: 2, exceptions: ['인턴'] },
  careerGap: { ignoreUnderMonths: 6, verifyUnderMonths: 12 }
};

test('validateLevel1Rules: 올바른 값이면 null', () => {
  assert.equal(validateLevel1Rules(VALID), null);
});

test('validateLevel1Rules: resumeUpdated 필드가 정수가 아니면 에러', () => {
  const bad = { ...VALID, resumeUpdated: { passWithinDays: 0, verifyWithinDays: 180 } };
  assert.ok(validateLevel1Rules(bad));
});

test('validateLevel1Rules: exceptions가 빈 배열이면 에러', () => {
  const bad = { ...VALID, shortTenure: { ...VALID.shortTenure, exceptions: [] } };
  assert.ok(validateLevel1Rules(bad));
});

test('validateLevel1Rules: careerGap 필드 누락이면 에러', () => {
  const bad = { ...VALID, careerGap: undefined };
  assert.ok(validateLevel1Rules(bad));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test handlers/talent-search-policy/level1-rules.test.js`
Expected: FAIL — `level1-rules.js` 파일 자체가 없어서 import 에러

- [ ] **Step 3: 핸들러 작성**

```js
/**
 * handlers/talent-search-policy/level1-rules.js
 *
 * PATCH { level1Rules: {...}, changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 1B-2: Level1 문턱값 수정. "수정 = 새 버전 즉시 생성+적용"이라 초안 개념은
 * 없다(1B-4에서 추가 예정). 필드 간 대소관계(예: 확인필요 일수가 통과일수
 * 보다 커야 함) 같은 세밀한 검증은 이번 범위 밖(스펙 참고) -- 최소 타입
 * 검증만 한다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, createPolicyVersion, policy_out } from '../_lib/talentSearchPolicy.js';

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

export function validateLevel1Rules(l1) {
  if (!l1 || typeof l1 !== 'object') return '값이 올바르지 않아요';
  const ru = l1.resumeUpdated, st = l1.shortTenure, cg = l1.careerGap;
  if (!ru || !isPositiveInt(ru.passWithinDays) || !isPositiveInt(ru.verifyWithinDays)) return '이력서 업데이트 기준이 올바르지 않아요';
  if (!st || !isPositiveInt(st.monthsThreshold) || !isPositiveInt(st.lookbackYears) || !isPositiveInt(st.countThreshold)) return '단기근속 기준이 올바르지 않아요';
  if (!Array.isArray(st.exceptions) || st.exceptions.length === 0 || st.exceptions.some(e => typeof e !== 'string' || !e.trim())) return '단기근속 예외사유가 올바르지 않아요';
  if (!cg || !isPositiveInt(cg.ignoreUnderMonths) || !isPositiveInt(cg.verifyUnderMonths)) return '경력 공백 기준이 올바르지 않아요';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { level1Rules, changeReason } = req.body || {};
  if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });
  const validationError = validateLevel1Rules(level1Rules);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const current = await getActivePolicy();
    if (!current) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    const updated = await createPolicyVersion(current, { level1_rules: level1Rules }, account.id, changeReason.trim());
    return res.status(200).json(policy_out(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준 수정에 실패했어요' });
  }
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test handlers/talent-search-policy/level1-rules.test.js`
Expected: 4개 테스트 전부 PASS

- [ ] **Step 5: 라우트 등록**

`api/[...path].js`에 import 추가 (`talentSearchPolicyIndex` import 줄 다음):

```js
import talentSearchPolicyLevel1Rules from '../handlers/talent-search-policy/level1-rules.js';
```

`ROUTES` 배열에 항목 추가 (`talent-search-policy` 항목 다음):

```js
  { pattern: ['talent-search-policy', 'level1-rules'], handler: talentSearchPolicyLevel1Rules },
```

- [ ] **Step 6: 수동 확인**

Run: 기존 ADMIN 테스트 계정 쿠키로:
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/level1-rules -H "Content-Type: application/json" -d '{"level1Rules":{"resumeUpdated":{"passWithinDays":90,"verifyWithinDays":180},"shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,"exceptions":["인턴"]},"careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}},"changeReason":"수동 확인용 테스트"}'
```
Expected: `{"versionNo":2, ...}` — 버전 번호가 1에서 2로 올라감. 이어서 `curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy`로 다시 조회해서 `versionNo:2`가 유지되는지 확인.
Run: `changeReason` 없이 같은 요청 → `400 {"error":"변경 사유를 입력해주세요"}` 확인

- [ ] **Step 7: Commit**

```bash
git add "handlers/talent-search-policy/level1-rules.js" "handlers/talent-search-policy/level1-rules.test.js" "api/[...path].js"
git commit -m "feat: PATCH /api/talent-search-policy/level1-rules 엔드포인트 추가"
```

---

### Task 3: `PATCH /api/talent-search-policy/common-fit-weights`

**Files:**
- Create: `handlers/talent-search-policy/common-fit-weights.js`
- Test: `handlers/talent-search-policy/common-fit-weights.test.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 헬퍼들
- Produces: `PATCH /api/talent-search-policy/common-fit-weights` `{ commonFitWeights, changeReason }` → `200 { ...policy_out 응답 }`. `export function validateCommonFitWeights(items)` — 통과하면 `null`, 실패하면 한국어 에러 문자열.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// handlers/talent-search-policy/common-fit-weights.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommonFitWeights } from './common-fit-weights.js';

test('validateCommonFitWeights: 합계 40이면 null', () => {
  const items = [
    { key: 'a', label: '항목A', points: 20 },
    { key: 'b', label: '항목B', points: 20 }
  ];
  assert.equal(validateCommonFitWeights(items), null);
});

test('validateCommonFitWeights: 항목 1개여도 합계만 40이면 통과 (개수 제한 없음)', () => {
  assert.equal(validateCommonFitWeights([{ key: 'only', label: '단일 항목', points: 40 }]), null);
});

test('validateCommonFitWeights: 합계가 40이 아니면 에러', () => {
  const items = [{ key: 'a', label: '항목A', points: 39 }];
  assert.ok(validateCommonFitWeights(items));
});

test('validateCommonFitWeights: 빈 배열이면 에러', () => {
  assert.ok(validateCommonFitWeights([]));
});

test('validateCommonFitWeights: key 중복이면 에러', () => {
  const items = [
    { key: 'dup', label: '항목A', points: 20 },
    { key: 'dup', label: '항목B', points: 20 }
  ];
  assert.ok(validateCommonFitWeights(items));
});

test('validateCommonFitWeights: label이 빈 문자열이면 에러', () => {
  assert.ok(validateCommonFitWeights([{ key: 'a', label: '  ', points: 40 }]));
});

test('validateCommonFitWeights: points가 음수면 에러', () => {
  assert.ok(validateCommonFitWeights([{ key: 'a', label: '항목A', points: -1 }]));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test handlers/talent-search-policy/common-fit-weights.test.js`
Expected: FAIL — 파일 없음

- [ ] **Step 3: 핸들러 작성**

```js
/**
 * handlers/talent-search-policy/common-fit-weights.js
 *
 * PATCH { commonFitWeights: [...], changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 1B-2: 공통 적합도 40점 배점 수정. 항목은 최소 1개, 개수 제한 없음(자유롭게
 * 추가/삭제 가능 -- 사용자 확인된 요구사항), 각 항목 key는 배열 안에서
 * 중복되면 안 되고, 합계는 정확히 40이어야 한다. key는 항목의 "정체성"이라
 * 라벨을 바꿔도 유지된다(새 항목의 key는 프론트에서 생성).
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, createPolicyVersion, policy_out } from '../_lib/talentSearchPolicy.js';

export function validateCommonFitWeights(items) {
  if (!Array.isArray(items) || items.length === 0) return '항목이 1개 이상 있어야 해요';
  const seenKeys = new Set();
  let sum = 0;
  for (const item of items) {
    if (!item || typeof item.key !== 'string' || !item.key.trim()) return '항목 key가 올바르지 않아요';
    if (seenKeys.has(item.key)) return '항목 key가 중복돼요';
    seenKeys.add(item.key);
    if (typeof item.label !== 'string' || !item.label.trim()) return '항목 이름을 입력해주세요';
    if (typeof item.points !== 'number' || !Number.isFinite(item.points) || item.points < 0) return '배점은 0 이상의 숫자여야 해요';
    sum += item.points;
  }
  if (sum !== 40) return `배점 합계가 40점이어야 해요 (지금 합계: ${sum}점)`;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { commonFitWeights, changeReason } = req.body || {};
  if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });
  const validationError = validateCommonFitWeights(commonFitWeights);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const current = await getActivePolicy();
    if (!current) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    const updated = await createPolicyVersion(current, { common_fit_weights: commonFitWeights }, account.id, changeReason.trim());
    return res.status(200).json(policy_out(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준 수정에 실패했어요' });
  }
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test handlers/talent-search-policy/common-fit-weights.test.js`
Expected: 7개 테스트 전부 PASS

- [ ] **Step 5: 라우트 등록**

`api/[...path].js`에 import 추가 (`talentSearchPolicyLevel1Rules` import 줄 다음):

```js
import talentSearchPolicyCommonFitWeights from '../handlers/talent-search-policy/common-fit-weights.js';
```

`ROUTES` 배열에 항목 추가 (`talent-search-policy/level1-rules` 항목 다음):

```js
  { pattern: ['talent-search-policy', 'common-fit-weights'], handler: talentSearchPolicyCommonFitWeights },
```

- [ ] **Step 6: 수동 확인**

Run: 기존 ADMIN 테스트 계정 쿠키로 (항목 3개, 합계 40):
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/common-fit-weights -H "Content-Type: application/json" -d '{"commonFitWeights":[{"key":"ownership","label":"목표완결성·오너십","points":20},{"key":"execution","label":"실행력","points":15},{"key":"newitem","label":"새 항목","points":5}],"changeReason":"수동 확인 -- 항목 추가 테스트"}'
```
Expected: `200`, `commonFitWeights`에 3개 항목(합계 40) 반영, `versionNo`가 그 전보다 +1
Run: 합계가 40이 아닌 값으로 같은 요청 → `400 {"error":"배점 합계가 40점이어야 해요 (지금 합계: ...)"}`확인

- [ ] **Step 7: Commit**

```bash
git add "handlers/talent-search-policy/common-fit-weights.js" "handlers/talent-search-policy/common-fit-weights.test.js" "api/[...path].js"
git commit -m "feat: PATCH /api/talent-search-policy/common-fit-weights 엔드포인트 추가"
```

---

### Task 4: 화면에 "수정" 버튼 + 두 모달 추가

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 2의 `PATCH /talent-search-policy/level1-rules`, Task 3의 `PATCH /talent-search-policy/common-fit-weights`
- Produces: 없음(화면 종단)

- [ ] **Step 1: 정책을 모듈 전역 변수에 저장**

`loadAndRenderTalentSearchPolicy` 함수 바로 앞에 전역 변수 선언 추가:

```js
let tsPolicy = null;
let commonFitDraft = [];
```

- [ ] **Step 2: `loadAndRenderTalentSearchPolicy`에 정책 저장 + 수정 버튼 추가**

함수 안의 `const policy = await apiGet('/talent-search-policy');` 바로 다음 줄에 추가:

```js
  tsPolicy = policy;
```

Level1 카드의 `</div>` (경력 공백 설명이 끝나는 `</div>` 다음, 카드를 닫는 `</div>` 앞)에 버튼 추가 — 현재:

```html
    <div class="section">
      <div class="section-head"><h3>1차 필터(Level 1) 기준</h3></div>
      <div style="font-size:13px;line-height:1.8;">
        이력서 업데이트: <b>${l1.resumeUpdated.passWithinDays}일 이내</b> 통과, <b>${l1.resumeUpdated.verifyWithinDays}일</b>까지는 확인 필요, 그 이후는 제외<br>
        잦은 이직: 완료 경력 <b>${l1.shortTenure.monthsThreshold}개월 미만</b>이 단기근속, 최근 <b>${l1.shortTenure.lookbackYears}년</b> 내 <b>${l1.shortTenure.countThreshold}회</b> 이상이면 확인 필요 (예외: ${l1.shortTenure.exceptions.map(escapeHtml).join(', ')})<br>
        경력 공백: <b>${l1.careerGap.ignoreUnderMonths}개월 미만</b> 무시, <b>${l1.careerGap.verifyUnderMonths}개월</b>까지 확인 필요, 그 이상은 설명 필요
      </div>
    </div>
```

이걸 아래로 교체:

```html
    <div class="section">
      <div class="section-head"><h3>1차 필터(Level 1) 기준</h3></div>
      <div style="font-size:13px;line-height:1.8;">
        이력서 업데이트: <b>${l1.resumeUpdated.passWithinDays}일 이내</b> 통과, <b>${l1.resumeUpdated.verifyWithinDays}일</b>까지는 확인 필요, 그 이후는 제외<br>
        잦은 이직: 완료 경력 <b>${l1.shortTenure.monthsThreshold}개월 미만</b>이 단기근속, 최근 <b>${l1.shortTenure.lookbackYears}년</b> 내 <b>${l1.shortTenure.countThreshold}회</b> 이상이면 확인 필요 (예외: ${l1.shortTenure.exceptions.map(escapeHtml).join(', ')})<br>
        경력 공백: <b>${l1.careerGap.ignoreUnderMonths}개월 미만</b> 무시, <b>${l1.careerGap.verifyUnderMonths}개월</b>까지 확인 필요, 그 이상은 설명 필요
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditLevel1Modal()">수정</button>
    </div>
```

공통 40점 카드도 같은 방식으로 — 현재:

```html
    <div class="section">
      <div class="section-head"><h3>공통 적합도 40점 (합계 ${commonSum}점)</h3></div>
      <div class="grid4">
        ${policy.commonFitWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
    </div>
```

이걸 아래로 교체:

```html
    <div class="section">
      <div class="section-head"><h3>공통 적합도 40점 (합계 ${commonSum}점)</h3></div>
      <div class="grid4">
        ${policy.commonFitWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditCommonFitModal()">수정</button>
    </div>
```

- [ ] **Step 3: Level1 수정 모달 추가**

`loadAndRenderTalentSearchPolicy` 함수가 끝나는 `}` 바로 다음에 추가:

```js
function openEditLevel1Modal(){
  const l1 = tsPolicy.level1Rules;
  showModal(`
    <h3>1차 필터(Level 1) 기준 수정</h3>
    <div class="field"><label>이력서 업데이트 — 통과 기준(일)</label><input id="f-l1-pass" type="number" min="1" value="${l1.resumeUpdated.passWithinDays}"></div>
    <div class="field"><label>이력서 업데이트 — 확인필요 기준(일)</label><input id="f-l1-verify" type="number" min="1" value="${l1.resumeUpdated.verifyWithinDays}"></div>
    <div class="field"><label>단기근속 — 개월 미만</label><input id="f-l1-months" type="number" min="1" value="${l1.shortTenure.monthsThreshold}"></div>
    <div class="field"><label>단기근속 — 최근 몇 년</label><input id="f-l1-years" type="number" min="1" value="${l1.shortTenure.lookbackYears}"></div>
    <div class="field"><label>단기근속 — 몇 회 이상</label><input id="f-l1-count" type="number" min="1" value="${l1.shortTenure.countThreshold}"></div>
    <div class="field"><label>단기근속 예외사유 (쉼표로 구분)</label><input id="f-l1-exceptions" value="${escapeHtml(l1.shortTenure.exceptions.join(', '))}"></div>
    <div class="field"><label>경력 공백 — 무시 기준(개월 미만)</label><input id="f-l1-gapignore" type="number" min="1" value="${l1.careerGap.ignoreUnderMonths}"></div>
    <div class="field"><label>경력 공백 — 확인필요 기준(개월)</label><input id="f-l1-gapverify" type="number" min="1" value="${l1.careerGap.verifyUnderMonths}"></div>
    <div class="field"><label>변경 사유</label><input id="f-l1-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="l1-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveLevel1Rules()">저장</button></div>
  `);
}
async function saveLevel1Rules(){
  const level1Rules = {
    resumeUpdated: {
      passWithinDays: Number(document.getElementById('f-l1-pass').value),
      verifyWithinDays: Number(document.getElementById('f-l1-verify').value)
    },
    shortTenure: {
      monthsThreshold: Number(document.getElementById('f-l1-months').value),
      lookbackYears: Number(document.getElementById('f-l1-years').value),
      countThreshold: Number(document.getElementById('f-l1-count').value),
      exceptions: document.getElementById('f-l1-exceptions').value.split(',').map(s=>s.trim()).filter(Boolean)
    },
    careerGap: {
      ignoreUnderMonths: Number(document.getElementById('f-l1-gapignore').value),
      verifyUnderMonths: Number(document.getElementById('f-l1-gapverify').value)
    }
  };
  const changeReason = document.getElementById('f-l1-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/level1-rules', {level1Rules, changeReason}); }
  catch(err){
    const box = document.getElementById('l1-edit-error');
    box.textContent = err.message; box.style.display = 'block';
    return;
  }
  closeModal();
  await loadAndRenderTalentSearchPolicy();
}
```

- [ ] **Step 4: 공통 40점 수정 모달 추가 (항목 추가/삭제 가능한 동적 목록)**

`saveLevel1Rules` 함수 바로 다음에 추가:

```js
function openEditCommonFitModal(){
  commonFitDraft = tsPolicy.commonFitWeights.map(w=>({key:w.key, label:w.label, points:w.points}));
  showModal(`
    <h3>공통 적합도 40점 수정</h3>
    <div id="commonfit-rows"></div>
    <button class="btn ghost sm" onclick="addCommonFitRow()">+ 항목 추가</button>
    <div style="margin:10px 0;font-size:13px;">합계: <b id="commonfit-sum"></b>/40</div>
    <div class="field"><label>변경 사유</label><input id="f-commonfit-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="commonfit-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveCommonFitWeights()">저장</button></div>
  `, true);
  renderCommonFitRows();
}
function renderCommonFitRows(){
  const el = document.getElementById('commonfit-rows');
  if(!el) return;
  el.innerHTML = commonFitDraft.map((w,i)=>`
    <div class="field" style="display:flex;gap:8px;align-items:center;">
      <input type="text" value="${escapeHtml(w.label)}" placeholder="항목 이름" style="flex:2;" onchange="commonFitDraft[${i}].label=this.value">
      <input type="number" value="${w.points}" placeholder="배점" style="flex:1;" onchange="commonFitDraft[${i}].points=Number(this.value); renderCommonFitSum();">
      <button class="btn ghost sm" onclick="removeCommonFitRow(${i})">삭제</button>
    </div>
  `).join('');
  renderCommonFitSum();
}
function renderCommonFitSum(){
  const sumEl = document.getElementById('commonfit-sum');
  if(!sumEl) return;
  const sum = commonFitDraft.reduce((s,w)=>s+(Number(w.points)||0),0);
  sumEl.textContent = sum;
  sumEl.style.color = sum===40 ? 'var(--primary-dark)' : 'var(--red)';
}
function addCommonFitRow(){
  commonFitDraft.push({key: 'item_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), label:'', points:0});
  renderCommonFitRows();
}
function removeCommonFitRow(i){ commonFitDraft.splice(i,1); renderCommonFitRows(); }
async function saveCommonFitWeights(){
  const changeReason = document.getElementById('f-commonfit-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/common-fit-weights', {commonFitWeights: commonFitDraft, changeReason}); }
  catch(err){
    const box = document.getElementById('commonfit-edit-error');
    box.textContent = err.message; box.style.display = 'block';
    return;
  }
  closeModal();
  await loadAndRenderTalentSearchPolicy();
}
```

- [ ] **Step 5: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000 재사용 시 재시작), 브라우저에서 ADMIN 테스트 계정으로 로그인 → 인재검색 → 기준 관리센터
Expected:
1. "1차 필터" 카드 아래 "수정" 버튼 클릭 → 모달에 지금 값이 미리 채워져 있음 → 아무 값이나 하나 바꾸고 변경사유 입력 후 저장 → 모달 닫히고 화면의 버전 번호가 하나 올라가고 바뀐 값이 반영됨
2. "공통 40점" 카드 아래 "수정" 버튼 클릭 → 모달에서 "+ 항목 추가"로 새 행 추가, 기존 항목 하나 "삭제"로 제거, 배점을 조정해서 합계를 정확히 40으로 맞춤(합계 표시가 초록/빨강으로 바뀌는지 확인) → 변경사유 입력 후 저장 → 반영 확인
3. 합계를 40이 아니게 만들고 저장 시도 → 에러 메시지가 모달 안에 보임(닫히지 않음)
4. 변경사유를 비우고 저장 시도 → "변경 사유를 입력해주세요" 에러 확인

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: 기준 관리센터에 Level1/공통40점 수정 모달 추가(공통40점은 항목 추가/삭제 가능)"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 "포함" 항목(Level1 API+모달, 공통40점 API+모달(추가/삭제 포함), 공유 헬퍼) 전부 Task 1~4에 매핑됨. "포함 안 함"(직무60점/임계값/하루상한, 초안/버전이력/복구/가상후보) 은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음.
- **타입/이름 일관성**: `level1Rules`/`commonFitWeights`(camelCase, API) ↔ `level1_rules`/`common_fit_weights`(snake_case, DB)가 Task 1(공유 헬퍼)부터 Task 2/3/4까지 동일하게 유지됨. `validateLevel1Rules`/`validateCommonFitWeights` 함수명이 export 선언(Task 2/3)과 테스트 import(Task 2/3의 Step 1)에서 일치. `tsPolicy`/`commonFitDraft` 전역 변수명이 Task 4 안에서 일관되게 참조됨.

## 실행 순서 안내

Task 1(공유 헬퍼) → Task 2(Level1 API, Task 1 필요) → Task 3(공통40점 API, Task 1 필요, Task 2와는 서로 독립적이라 순서 바꿔도 무방하나 계획상 순서 고정) → Task 4(화면, Task 2+3의 API 필요) 순서로 진행.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 두 모달로 실제 값을 수정하는 화면 캡처(수정 전/후, 버전 번호가 올라가는 것)
2. 각 Task의 수동 확인 절차 통과 결과, 단위테스트 통과 결과(11개 — Level1 4개 + 공통40점 7개)
3. 다음 단계(1B-3: 직무 60점 + 임계값·하루상한 수정) 착수 여부
