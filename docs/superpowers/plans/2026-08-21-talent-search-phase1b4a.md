# 인재검색 Phase 1B-4a (초안 상태 도입) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 기준 관리센터의 카드 저장 동작을 "즉시 적용"에서 "초안에 저장 → 별도 적용/버리기"로 바꾼다. 스키마 변경 없음 — 기존 `status`(draft/active/superseded) 컬럼을 실제로 활용하는 로직을 처음 추가한다.

**Architecture:** `handlers/_lib/talentSearchPolicy.js`의 `createPolicyVersion`(즉시 supersede+active-insert)을 제거하고 `getDraftPolicy`/`saveDraftOverrides`/`applyDraft`/`discardDraft` 네 함수로 대체한다. 기존 5개 PATCH 핸들러가 공유하는 `makePolicyPatchHandler` 팩토리는 이제 `saveDraftOverrides`만 호출하도록 바뀌고(핸들러 파일 5개 자체는 무수정), `changeReason`은 팩토리에서 더 이상 요구하지 않는다. 새 엔드포인트 2개(`draft/apply`, `draft` DELETE)와 `GET /talent-search-policy` 응답에 `draft` 필드가 추가된다. 프론트는 5개 모달에서 변경사유 입력칸을 없애고, 카드 렌더링을 재사용 가능한 body-only 함수로 뽑아서 초안이 있을 때 "기존→초안" 비교와 적용/버리기 배너를 만든다.

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`(`sql`, `sql.transaction`).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-21-talent-search-phase1b4a-design.md` — 정확한 동작/API 모양은 이 문서에서 그대로 가져온다.
- 스키마 변경 없음(`sql/` 신규 마이그레이션 파일 없음) — `talent_search_policy_versions.status`는 이미 draft/active/superseded 컨벤션으로 존재한다.
- 초안은 전역에서 **한 번에 하나만** 존재한다. 카드를 저장하면 초안이 없으면 새로 만들고(활성 버전을 베이스로), 있으면 그 초안 행을 그대로 UPDATE(병합)한다 — 여러 초안이 동시에 생기지 않는다.
- **변경사유는 "적용하기"에서만** 받는다 — 5개 카드의 PATCH 요청 body에 더 이상 `changeReason`이 없다.
- `daily_recommend_cap_default`/`daily_recommend_cap_absolute_max` 등 override 키 오타 방지 가드(`validateOverrideKeys`, `handlers/_lib/talentSearchPolicyValidate.js`)는 새 저장 경로(`saveDraftOverrides`)에도 그대로 적용한다.
- 모든 엔드포인트는 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님, 기존과 동일).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case(`policy_out`, 기존 그대로 재사용).
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에 반드시 등록한다(패턴: `['talent-search-policy','draft']`은 DELETE용, `['talent-search-policy','draft','apply']`은 PATCH용 — 세그먼트 개수가 달라 라우팅 충돌 없음).
- 이 프로젝트는 순수 계산 로직만 `node --test`로 단위테스트하고, DB/HTTP/UI는 로컬 dev 서버로 수동 검증한다. 이번 작업은 DB를 직접 다루는 함수/엔드포인트뿐이라 새 자동 테스트는 추가하지 않는다(기존 `talentSearchPolicyValidate.test.js`의 검증 함수들은 이번에 손대지 않으므로 그대로 통과해야 함).
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖.
- 테스트 계정: `preview-test@selfdiylab.invalid` / `Preview1234` (ADMIN).

---

### Task 1: 초안 저장/적용/버리기 백엔드 로직 + 팩토리 전환

**Files:**
- Modify: `handlers/_lib/talentSearchPolicy.js`
- Modify: `handlers/_lib/talentSearchPolicyValidate.js` (주석 1곳만 — `createPolicyVersion` 언급 갱신)

**Interfaces:**
- Produces: `export async function getDraftPolicy()` — 초안 행(snake_case, 없으면 `null`) 반환. `export async function saveDraftOverrides(overrides, actorAccountId)` — 초안이 있으면 그 행을 UPDATE, 없으면 활성 버전을 베이스로 새 초안 행을 INSERT, 병합된 결과 행 반환. `export async function applyDraft(changeReason, actorAccountId)` — 초안을 활성으로 승격(기존 활성은 superseded), 승격된 행 반환. `export async function discardDraft()` — 초안 행 삭제. `export function makePolicyPatchHandler({validate, buildOverrides})` — 기존과 시그니처 동일하지만 내부에서 `saveDraftOverrides`를 호출하고 `changeReason`을 더 이상 요구/전달하지 않음. `createPolicyVersion`은 이 Task에서 제거된다 — Task 2/3은 이 네 함수와 `getActivePolicy`/`policy_out`만 사용한다.

- [ ] **Step 1: `handlers/_lib/talentSearchPolicy.js` 전체를 아래로 교체**

```js
/**
 * handlers/_lib/talentSearchPolicy.js
 *
 * 인재검색 채점 정책(talent_search_policy_versions) 공용 헬퍼. 1B-2~1B-3까지는
 * "수정 = 새 버전을 만들어 즉시 활성화"(createPolicyVersion)였는데, 1B-4a부터는
 * 저장과 적용을 분리한다 -- 카드 저장은 초안(status='draft')에만 반영되고,
 * 별도의 "적용하기"를 거쳐야 실제 활성 버전이 바뀐다. 초안은 전역에서 한 번에
 * 하나만 존재한다: 이미 초안이 있으면 그 행을 그대로 UPDATE(병합)하고, 없으면
 * 활성 버전을 베이스로 새 초안 행을 만든다.
 */
import { sql } from './db.js';
import { requireTalentSearchAccess } from './accountAuth.js';
import { validateOverrideKeys } from './talentSearchPolicyValidate.js';

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

export async function getDraftPolicy() {
  const [row] = await sql`
    SELECT * FROM talent_search_policy_versions WHERE status = 'draft'
    ORDER BY version_no DESC LIMIT 1`;
  return row || null;
}

// overrides: 바뀌는 필드만 snake_case 키로 담은 객체. 초안이 이미 있으면 그
// 초안 값을 베이스로(활성 버전이 아니라 -- 초안 안에서 여러 카드를 이어서
// 고치는 경우를 위해), 없으면 활성 버전을 베이스로 병합한다.
export async function saveDraftOverrides(overrides, actorAccountId) {
  const keyError = validateOverrideKeys(overrides);
  if (keyError) throw new Error(keyError);

  const draft = await getDraftPolicy();
  const base = draft || await getActivePolicy();
  if (!base) throw new Error('적용 중인 기준이 없어요');
  const next = { ...base, ...overrides };

  if (draft) {
    const [updated] = await sql`
      UPDATE talent_search_policy_versions SET
        level1_rules = ${JSON.stringify(next.level1_rules)}::jsonb,
        common_fit_weights = ${JSON.stringify(next.common_fit_weights)}::jsonb,
        evidence_coefficients = ${JSON.stringify(next.evidence_coefficients)}::jsonb,
        job_fit_default_weights = ${JSON.stringify(next.job_fit_default_weights)}::jsonb,
        rounding_rule = ${JSON.stringify(next.rounding_rule)}::jsonb,
        thresholds = ${JSON.stringify(next.thresholds)}::jsonb,
        sort_tiebreak_rules = ${JSON.stringify(next.sort_tiebreak_rules)}::jsonb,
        daily_recommend_cap_default = ${next.daily_recommend_cap_default},
        daily_recommend_cap_absolute_max = ${next.daily_recommend_cap_absolute_max},
        data_retention_months = ${next.data_retention_months},
        created_by = ${actorAccountId}
      WHERE id = ${draft.id}
      RETURNING *`;
    return updated;
  }

  const [maxRow] = await sql`SELECT MAX(version_no) AS max FROM talent_search_policy_versions`;
  const nextVersionNo = (maxRow.max || 0) + 1;
  const [inserted] = await sql`
    INSERT INTO talent_search_policy_versions (
      version_no, level1_rules, common_fit_weights, evidence_coefficients,
      job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
      daily_recommend_cap_default, daily_recommend_cap_absolute_max,
      data_retention_months, status, created_by
    ) VALUES (
      ${nextVersionNo}, ${JSON.stringify(next.level1_rules)}::jsonb,
      ${JSON.stringify(next.common_fit_weights)}::jsonb, ${JSON.stringify(next.evidence_coefficients)}::jsonb,
      ${JSON.stringify(next.job_fit_default_weights)}::jsonb, ${JSON.stringify(next.rounding_rule)}::jsonb,
      ${JSON.stringify(next.thresholds)}::jsonb, ${JSON.stringify(next.sort_tiebreak_rules)}::jsonb,
      ${next.daily_recommend_cap_default}, ${next.daily_recommend_cap_absolute_max},
      ${next.data_retention_months}, 'draft', ${actorAccountId}
    ) RETURNING *`;
  return inserted;
}

// 초안을 활성으로 승격. 기존 활성 버전은 superseded로 밀려난다.
export async function applyDraft(changeReason, actorAccountId) {
  const draft = await getDraftPolicy();
  if (!draft) throw new Error('적용할 초안이 없어요');
  const current = await getActivePolicy();
  if (!current) throw new Error('적용 중인 기준이 없어요');

  const result = await sql.transaction([
    sql`UPDATE talent_search_policy_versions SET status = 'superseded' WHERE id = ${current.id}`,
    sql`UPDATE talent_search_policy_versions SET
          status = 'active', applied_at = now(),
          change_reason = ${changeReason}, created_by = ${actorAccountId}
        WHERE id = ${draft.id}
        RETURNING *`
  ]);
  return result[1][0];
}

export async function discardDraft() {
  await sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft'`;
}

// validate(body): body(= req.body 그대로, 더 이상 changeReason을 따로 빼지
// 않는다 -- 5개 카드 요청에 이제 changeReason이 없다)를 검사해 에러 메시지
// 문자열 또는 null 반환. buildOverrides(body): body를 saveDraftOverrides에
// 넘길 snake_case 필드 객체로 변환.
export function makePolicyPatchHandler({ validate, buildOverrides }) {
  return async function handler(req, res) {
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const account = await requireTalentSearchAccess(req, res);
    if (!account) return;

    const body = req.body || {};
    const validationError = validate(body);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const updated = await saveDraftOverrides(buildOverrides(body), account.id);
      return res.status(200).json(policy_out(updated));
    } catch (err) {
      // saveDraftOverrides가 "적용 중인 기준이 없어요"를 던지는 경우는 활성
      // 정책 자체가 없는 (사실상 불가능한) 상태라, 기존 factory가 지키던
      // 404 의미를 그대로 보존한다 -- 그 외 예외는 전부 일반 500.
      if (err.message === '적용 중인 기준이 없어요') return res.status(404).json({ error: err.message });
      console.error(err);
      return res.status(500).json({ error: '기준 수정에 실패했어요' });
    }
  };
}
```

- [ ] **Step 2: `handlers/_lib/talentSearchPolicyValidate.js`의 오래된 주석 갱신**

`POLICY_OVERRIDE_COLUMNS` 위 주석에서 "createPolicyVersion(handlers/_lib/talentSearchPolicy.js)에 넘길 수 있는" 부분을 "saveDraftOverrides/applyDraft(handlers/_lib/talentSearchPolicy.js)에 넘길 수 있는"으로 바꾼다. 현재:

```js
// createPolicyVersion(handlers/_lib/talentSearchPolicy.js)에 넘길 수 있는
// snake_case override 키 전체 목록 -- 실제 talent_search_policy_versions
```

이걸 아래로 교체:

```js
// saveDraftOverrides(handlers/_lib/talentSearchPolicy.js)에 넘길 수 있는
// snake_case override 키 전체 목록 -- 실제 talent_search_policy_versions
```

- [ ] **Step 3: 기존 순수 로직 테스트가 그대로 통과하는지 확인**

Run: `node --test`
Expected: 이 파일을 건드리지 않았으므로 기존 48개 테스트 전부 PASS (회귀 없음 — `talentSearchPolicy.js`는 DB를 다뤄서 원래도 이 테스트들의 대상이 아니었다).

- [ ] **Step 4: 수동 확인 — 초안 저장/병합/승격/버리기 전체 흐름**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), ADMIN 테스트 계정으로 로그인한 쿠키로:

```bash
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"preview-test@selfdiylab.invalid","password":"Preview1234"}'
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: 로그인 200, 정책 응답에 아직 `draft`/`level1Rules` 등 기존 필드만 있음(이 Task에서는 `index.js`를 안 건드렸으므로 `draft` 필드는 아직 응답에 없다 — Task 2에서 추가됨. 지금은 그냥 활성 버전 필드만 정상적으로 나오는지 확인).

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/level1-rules -H "Content-Type: application/json" -d '{"level1Rules":{"resumeUpdated":{"passWithinDays":90,"verifyWithinDays":180},"shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,"exceptions":["인턴"]},"careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}}'
```
Expected: `200`, 응답에 `"status":"draft"`, `versionNo`가 활성 버전보다 1 높음. (`changeReason`을 안 보냈는데도 400이 안 나는 것 확인 — 이제 요구하지 않음)

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: 여전히 `"status":"active"`인 예전 값 그대로 반환(방금 만든 초안이 활성 버전을 바꾸지 않았음 확인 — `getActivePolicy`가 여전히 옛 행을 가리킴).

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/common-fit-weights -H "Content-Type: application/json" -d '{"commonFitWeights":[{"key":"ownership","label":"목표완결성·오너십","points":20},{"key":"execution","label":"실행력","points":20}]}'
```
Expected: `200`, `versionNo`가 방금 만든 초안과 **동일**(같은 초안 행에 병합됐음 — 새 초안이 또 생기지 않았음 확인), `level1Rules`도 그대로 유지되고 있음(이전 초안 저장분이 안 지워짐).

이제 초안을 버리고 확인:
```bash
curl -s -b cookies.txt -X DELETE http://localhost:3000/api/talent-search-policy/draft
```
Expected: 이 시점엔 아직 `handlers/talent-search-policy/draft.js`가 없어서(Task 2에서 만듦) 404가 나는 게 정상 — 이 Step에서는 `saveDraftOverrides`/`getDraftPolicy` 로직 자체를 함수 레벨에서 확인한 것으로 충분하다. 초안이 DB에 남아있어도 문제 없음(Task 2의 검증에서 다시 확인하고 정리한다).

- [ ] **Step 5: Commit**

```bash
git add "handlers/_lib/talentSearchPolicy.js" "handlers/_lib/talentSearchPolicyValidate.js"
git commit -m "refactor: 인재검색 정책 저장을 즉시적용에서 초안(draft) 저장으로 전환"
```

---

### Task 2: 초안 적용/버리기 API + GET 응답에 draft 포함

**Files:**
- Create: `handlers/talent-search-policy/draft.js`
- Create: `handlers/talent-search-policy/draft/apply.js`
- Modify: `handlers/talent-search-policy/index.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 `getDraftPolicy`/`applyDraft`/`discardDraft`/`policy_out`(모두 `../_lib/talentSearchPolicy.js` 또는 `../../_lib/talentSearchPolicy.js`), `requireTalentSearchAccess`
- Produces: `DELETE /api/talent-search-policy/draft` → `200 {discarded:true}`. `PATCH /api/talent-search-policy/draft/apply` `{changeReason}` → `200 {...policy_out 응답(승격된 활성 버전)}`. `GET /api/talent-search-policy` → 기존 응답 그대로 + `draft: null | {...policy_out 모양}`.

- [ ] **Step 1: 초안 버리기 핸들러 작성**

```js
// handlers/talent-search-policy/draft.js
/**
 * DELETE /api/talent-search-policy/draft
 * Body 없음 -> 200 { discarded: true }
 *
 * 1B-4a: 지금 있는 초안을 완전히 버린다. 초안이 없어도 에러 없이 200(멱등) --
 * 이미 없는 걸 지우려 하는 건 실패로 볼 이유가 없다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { discardDraft } from '../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    await discardDraft();
    return res.status(200).json({ discarded: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '초안 삭제에 실패했어요' });
  }
}
```

- [ ] **Step 2: 초안 적용 핸들러 작성**

```js
// handlers/talent-search-policy/draft/apply.js
/**
 * PATCH /api/talent-search-policy/draft/apply
 * Body: { changeReason: string } -> 200 { ...policy_out 응답(새로 활성화된 버전) }
 *
 * 1B-4a: 초안을 활성 버전으로 승격한다. changeReason은 이 시점에 딱 한 번만
 * 받는다 -- 여러 카드를 고쳐 쌓은 초안 전체에 대한 사유이기 때문에, 카드별
 * 저장 액션에서는 더 이상 받지 않는다.
 */
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { getDraftPolicy, applyDraft, policy_out } from '../../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { changeReason } = req.body || {};
  if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });

  try {
    const draft = await getDraftPolicy();
    if (!draft) return res.status(404).json({ error: '적용할 초안이 없어요' });
    const updated = await applyDraft(changeReason.trim(), account.id);
    return res.status(200).json(policy_out(updated));
  } catch (err) {
    // applyDraft가 내부적으로 같은 두 조건을 다시 확인하며 던지는 에러 문구를
    // 그대로 이어받아 404로 매핑한다(위에서 이미 확인했으니 사실상 도달하지
    // 않지만, 방어적으로 의미를 보존한다) -- 그 외는 일반 500.
    if (err.message === '적용할 초안이 없어요' || err.message === '적용 중인 기준이 없어요') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: '초안 적용에 실패했어요' });
  }
}
```

- [ ] **Step 3: `GET /talent-search-policy`가 초안도 같이 반환하도록 수정**

`handlers/talent-search-policy/index.js` 전체를 아래로 교체:

```js
/**
 * handlers/talent-search-policy/index.js
 *
 * GET -> 200 { versionNo, level1Rules, ..., status, changeReason, appliedAt,
 *              createdAt, draft: null | {...같은 모양, status:'draft'} }
 *
 * 지금 적용 중인(status='active') 정책과, 있다면 초안(status='draft')을
 * 같이 반환한다. 활성 버전 필드는 최상위에 그대로 유지해서(1B-4a 이전
 * 프론트 호출부와 하위호환), draft는 추가 필드로만 얹는다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, getDraftPolicy, policy_out } from '../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const policy = await getActivePolicy();
    if (!policy) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    const draft = await getDraftPolicy();
    return res.status(200).json({ ...policy_out(policy), draft: draft ? policy_out(draft) : null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준을 불러오지 못했어요' });
  }
}
```

- [ ] **Step 4: 라우트 등록**

`api/[...path].js`의 `talentSearchPolicyThresholds` import 줄 다음에 추가:

```js
import talentSearchPolicyDraft from '../handlers/talent-search-policy/draft.js';
import talentSearchPolicyDraftApply from '../handlers/talent-search-policy/draft/apply.js';
```

`ROUTES` 배열의 `talent-search-policy/thresholds` 항목 다음에 추가:

```js
  { pattern: ['talent-search-policy', 'draft'], handler: talentSearchPolicyDraft },
  { pattern: ['talent-search-policy', 'draft', 'apply'], handler: talentSearchPolicyDraftApply },
```

- [ ] **Step 5: 수동 확인 — 전체 초안 생명주기**

Run: 기존 쿠키 재사용(`cookies.txt`), 서버 재시작 후:

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: `"draft":null`(Task 1 마지막에 만들어둔 초안이 있다면 여기서 보일 것 — 있으면 지우고 처음부터 다시 확인해도 되고, 그대로 이어서 확인해도 됨).

```bash
curl -s -b cookies.txt -X DELETE http://localhost:3000/api/talent-search-policy/draft
```
Expected: `200 {"discarded":true}` (초안이 있었으면 지워짐, 없었으면 그냥 200 — 멱등 확인).

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: `"draft":null`.

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/level1-rules -H "Content-Type: application/json" -d '{"level1Rules":{"resumeUpdated":{"passWithinDays":95,"verifyWithinDays":180},"shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,"exceptions":["인턴"]},"careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}}'
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: 두 번째 응답의 `draft`가 `passWithinDays:95`로 채워져 있고, 최상위 `level1Rules`는 여전히 옛 값(활성 버전 안 바뀜).

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/draft/apply -H "Content-Type: application/json" -d '{}'
```
Expected: `400 {"error":"변경 사유를 입력해주세요"}`.

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/draft/apply -H "Content-Type: application/json" -d '{"changeReason":"1B-4a 수동 확인 -- 이력서 업데이트 통과기준 95일로 조정"}'
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: apply 응답 `200`, `"status":"active"`, `passWithinDays:95`. 이어진 GET에서 최상위 `level1Rules.resumeUpdated.passWithinDays`가 `95`로 바뀌어 있고 `"draft":null`.

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/draft/apply -H "Content-Type: application/json" -d '{"changeReason":"초안 없을 때 재확인"}'
```
Expected: `404 {"error":"적용할 초안이 없어요"}`(방금 적용해서 초안이 이미 없으므로).

마지막에 값을 원래대로 되돌려서 정리(선택 사항이지만, 이후 Task 3의 화면 확인과 실제 데모를 위해 깨끗한 상태를 유지하려면):
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/level1-rules -H "Content-Type: application/json" -d '{"level1Rules":{"resumeUpdated":{"passWithinDays":90,"verifyWithinDays":180},"shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,"exceptions":["인턴"]},"careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}}'
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/draft/apply -H "Content-Type: application/json" -d '{"changeReason":"수동 확인 중 90일로 원복"}'
```

- [ ] **Step 6: Commit**

```bash
git add "handlers/talent-search-policy/draft.js" "handlers/talent-search-policy/draft/apply.js" "handlers/talent-search-policy/index.js" "api/[...path].js"
git commit -m "feat: 인재검색 정책 초안 적용(PATCH draft/apply)·버리기(DELETE draft) 엔드포인트 추가, GET에 draft 포함"
```

---

### Task 3: 화면 — 변경사유 입력칸 제거 + 초안 배너/비교 + 적용·버리기 UI

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 2의 `GET /talent-search-policy`(응답에 `draft` 포함), `PATCH /talent-search-policy/draft/apply`, `DELETE /talent-search-policy/draft`
- Produces: 없음(화면 종단). `renderLevel1Body(l1)`/`renderPointsListBody(items)`/`renderEvidenceBody(ec)`/`renderThresholdsBody(t, capDefault, capMax)`(카드 내용만 그리는 순수 함수, 초안 비교에서도 재사용), `renderPolicyDiff(active, draft)`, `openApplyDraftModal()`/`applyDraftNow()`, `discardDraftConfirm()`/`discardDraftNow()`가 새로 생김.

- [ ] **Step 1: 5개 모달에서 "변경 사유" 입력칸과 그 값 읽기 제거**

`openEditLevel1Modal` 안, 현재:

```html
    <div class="field"><label>경력 공백 — 확인필요 기준(개월)</label><input id="f-l1-gapverify" type="number" min="1" value="${l1.careerGap.verifyUnderMonths}"></div>
    <div class="field"><label>변경 사유</label><input id="f-l1-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="l1-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

이걸 아래로 교체(변경 사유 줄만 삭제):

```html
    <div class="field"><label>경력 공백 — 확인필요 기준(개월)</label><input id="f-l1-gapverify" type="number" min="1" value="${l1.careerGap.verifyUnderMonths}"></div>
    <div id="l1-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

`saveLevel1Rules` 안, 현재:

```js
  const changeReason = document.getElementById('f-l1-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/level1-rules', {level1Rules, changeReason}); }
```

이걸 아래로 교체:

```js
  try{ await apiPatch('/talent-search-policy/level1-rules', {level1Rules}); }
```

`openEditPointsListModal` 안, 현재:

```html
    <div style="margin:10px 0;font-size:13px;">합계: <b id="pointslist-sum"></b>/${config.expectedSum}</div>
    <div class="field"><label>변경 사유</label><input id="f-pointslist-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="pointslist-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

이걸 아래로 교체:

```html
    <div style="margin:10px 0;font-size:13px;">합계: <b id="pointslist-sum"></b>/${config.expectedSum}</div>
    <div id="pointslist-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

`savePointsList` 안, 현재:

```js
async function savePointsList(){
  const changeReason = document.getElementById('f-pointslist-reason').value.trim();
  try{ await apiPatch(pointsListConfig.apiPath, {[pointsListConfig.bodyKey]: pointsListDraft, changeReason}); }
```

이걸 아래로 교체:

```js
async function savePointsList(){
  try{ await apiPatch(pointsListConfig.apiPath, {[pointsListConfig.bodyKey]: pointsListDraft}); }
```

`openEditEvidenceModal` 안, 현재:

```html
    <div class="field"><label>없음 (%)</label><input id="f-ec-none" type="number" min="1" max="100" step="1" value="${Math.round(ec.none*100)}"></div>
    <div class="field"><label>변경 사유</label><input id="f-ec-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="ec-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

이걸 아래로 교체:

```html
    <div class="field"><label>없음 (%)</label><input id="f-ec-none" type="number" min="1" max="100" step="1" value="${Math.round(ec.none*100)}"></div>
    <div id="ec-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

`saveEvidenceCoefficients` 안, 현재:

```js
  const changeReason = document.getElementById('f-ec-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/evidence-coefficients', {evidenceCoefficients, changeReason}); }
```

이걸 아래로 교체:

```js
  try{ await apiPatch('/talent-search-policy/evidence-coefficients', {evidenceCoefficients}); }
```

`openEditThresholdsModal` 안, 현재:

```html
    <div class="field"><label>하루 추천상한 — 절대상한 (명)</label><input id="f-th-capmax" type="number" min="1" value="${tsPolicy.dailyRecommendCapAbsoluteMax}"></div>
    <div class="field"><label>변경 사유</label><input id="f-th-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="th-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

이걸 아래로 교체:

```html
    <div class="field"><label>하루 추천상한 — 절대상한 (명)</label><input id="f-th-capmax" type="number" min="1" value="${tsPolicy.dailyRecommendCapAbsoluteMax}"></div>
    <div id="th-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
```

`saveThresholds` 안, 현재:

```js
  const changeReason = document.getElementById('f-th-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/thresholds', {thresholds, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax, changeReason}); }
```

이걸 아래로 교체:

```js
  try{ await apiPatch('/talent-search-policy/thresholds', {thresholds, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax}); }
```

- [ ] **Step 2: 카드 본문을 재사용 가능한 함수로 분리**

`let tsPolicy = null;` 바로 다음(`async function loadAndRenderTalentSearchPolicy(){` 앞)에 추가:

```js
let tsActivePolicy = null;
function renderLevel1Body(l1){
  return `
    이력서 업데이트: <b>${l1.resumeUpdated.passWithinDays}일 이내</b> 통과, <b>${l1.resumeUpdated.verifyWithinDays}일</b>까지는 확인 필요, 그 이후는 제외<br>
    잦은 이직: 완료 경력 <b>${l1.shortTenure.monthsThreshold}개월 미만</b>이 단기근속, 최근 <b>${l1.shortTenure.lookbackYears}년</b> 내 <b>${l1.shortTenure.countThreshold}회</b> 이상이면 확인 필요 (예외: ${l1.shortTenure.exceptions.map(escapeHtml).join(', ')})<br>
    경력 공백: <b>${l1.careerGap.ignoreUnderMonths}개월 미만</b> 무시, <b>${l1.careerGap.verifyUnderMonths}개월</b>까지 확인 필요, 그 이상은 설명 필요
  `;
}
function renderPointsListBody(items){
  const sum = items.reduce((s,w)=>s+w.points,0);
  return `<div class="grid4">${items.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}</div><div style="font-size:12px;color:var(--sub);margin-top:6px;">합계 ${sum}점</div>`;
}
function renderEvidenceBody(ec){
  return `<div class="grid4">
    <div class="kpi"><div class="label">없음</div><div class="value">${Math.round(ec.none*100)}%</div></div>
    <div class="kpi"><div class="label">약함</div><div class="value">${Math.round(ec.weak*100)}%</div></div>
    <div class="kpi"><div class="label">부분</div><div class="value">${Math.round(ec.partial*100)}%</div></div>
    <div class="kpi"><div class="label">명확</div><div class="value">${Math.round(ec.clear*100)}%</div></div>
  </div>`;
}
function renderThresholdsBody(t, capDefault, capMax){
  return `<div class="grid4">
    <div class="kpi"><div class="label">총점 기준</div><div class="value">${t.totalScoreMin}점 이상</div></div>
    <div class="kpi"><div class="label">직무점수 기준</div><div class="value">${t.jobFitScoreMin}점 이상</div></div>
    <div class="kpi"><div class="label">의미있는 근거</div><div class="value">${t.minMeaningfulEvidenceCount}개 이상</div></div>
    <div class="kpi"><div class="label">하루 추천 상한</div><div class="value">${capDefault}명</div><div style="font-size:11px;color:var(--sub);margin-top:4px;">절대 상한 ${capMax}명</div></div>
  </div>`;
}
function renderPolicyDiff(active, draft){
  const rows = [];
  if(JSON.stringify(active.level1Rules) !== JSON.stringify(draft.level1Rules)){
    rows.push({title:'1차 필터(Level 1) 기준', from: renderLevel1Body(active.level1Rules), to: renderLevel1Body(draft.level1Rules)});
  }
  if(JSON.stringify(active.commonFitWeights) !== JSON.stringify(draft.commonFitWeights)){
    rows.push({title:'공통 적합도 40점', from: renderPointsListBody(active.commonFitWeights), to: renderPointsListBody(draft.commonFitWeights)});
  }
  if(JSON.stringify(active.jobFitDefaultWeights) !== JSON.stringify(draft.jobFitDefaultWeights)){
    rows.push({title:'직무 적합도 60점', from: renderPointsListBody(active.jobFitDefaultWeights), to: renderPointsListBody(draft.jobFitDefaultWeights)});
  }
  if(JSON.stringify(active.evidenceCoefficients) !== JSON.stringify(draft.evidenceCoefficients)){
    rows.push({title:'근거수준별 점수', from: renderEvidenceBody(active.evidenceCoefficients), to: renderEvidenceBody(draft.evidenceCoefficients)});
  }
  const activeThresholdsKey = JSON.stringify([active.thresholds, active.dailyRecommendCapDefault, active.dailyRecommendCapAbsoluteMax]);
  const draftThresholdsKey = JSON.stringify([draft.thresholds, draft.dailyRecommendCapDefault, draft.dailyRecommendCapAbsoluteMax]);
  if(activeThresholdsKey !== draftThresholdsKey){
    rows.push({title:'추천 임계값 · 하루 추천상한', from: renderThresholdsBody(active.thresholds, active.dailyRecommendCapDefault, active.dailyRecommendCapAbsoluteMax), to: renderThresholdsBody(draft.thresholds, draft.dailyRecommendCapDefault, draft.dailyRecommendCapAbsoluteMax)});
  }
  if(rows.length === 0) return '';
  return `<div style="margin-top:14px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:8px;">바뀐 항목</div>
    ${rows.map(r=>`
      <div style="margin-bottom:12px;">
        <div style="font-size:12.5px;font-weight:600;margin-bottom:4px;">${escapeHtml(r.title)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div><div style="font-size:11px;color:var(--sub);margin-bottom:4px;">기존</div>${r.from}</div>
          <div><div style="font-size:11px;color:var(--sub);margin-bottom:4px;">초안</div>${r.to}</div>
        </div>
      </div>
    `).join('')}
  </div>`;
}
```

- [ ] **Step 3: `loadAndRenderTalentSearchPolicy`를 초안 인지형으로 교체**

전체 함수를 아래로 교체:

```js
async function loadAndRenderTalentSearchPolicy(){
  const el = document.getElementById('talentsearch-policy-body');
  if(!el) return;
  el.innerHTML = '불러오는 중...';
  try{
  const policy = await apiGet('/talent-search-policy');
  const draft = policy.draft;
  tsActivePolicy = policy;
  tsPolicy = draft || policy;

  const view = tsPolicy;
  const l1 = view.level1Rules;
  const commonSum = view.commonFitWeights.reduce((s,w)=>s+w.points,0);
  const jobFitSum = view.jobFitDefaultWeights.reduce((s,w)=>s+w.points,0);
  const ec = view.evidenceCoefficients;

  const bannerHtml = draft ? `
    <div class="section" style="border-color:var(--primary);">
      <div class="section-head"><div><h3>수정 중인 초안이 있어요 (버전 ${draft.versionNo}, 아직 적용 안 됨)</h3><div class="desc">지금 적용 중인 버전은 ${policy.versionNo}예요</div></div></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn primary sm" onclick="openApplyDraftModal()">적용하기</button>
        <button class="btn ghost sm" onclick="discardDraftConfirm()">초안 버리기</button>
      </div>
      ${renderPolicyDiff(policy, draft)}
    </div>
  ` : '';

  el.innerHTML = bannerHtml + `
    <div class="section">
      <div class="section-head"><div><h3>현재 적용 중 · 버전 ${policy.versionNo}</h3><div class="desc">아래 각 카드의 "수정" 버튼으로 값을 바꿀 수 있어요${draft ? ' — 지금 카드는 초안 값을 보여주고 있어요(적용 전까지 실제로는 안 바뀜)' : ''}</div></div></div>
    </div>
    <div class="section">
      <div class="section-head"><h3>1차 필터(Level 1) 기준</h3></div>
      <div style="font-size:13px;line-height:1.8;">${renderLevel1Body(l1)}</div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditLevel1Modal()">수정</button>
    </div>
    <div class="section">
      <div class="section-head"><h3>공통 적합도 40점 (합계 ${commonSum}점)</h3></div>
      <div class="grid4">
        ${view.commonFitWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditCommonFitModal()">수정</button>
    </div>
    <div class="section">
      <div class="section-head"><h3>직무 적합도 60점 기본 배점 (합계 ${jobFitSum}점)</h3></div>
      <div class="grid4">
        ${view.jobFitDefaultWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditJobFitModal()">수정</button>
    </div>
    <div class="section">
      <div class="section-head"><h3>근거수준별 점수</h3></div>
      ${renderEvidenceBody(ec)}
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditEvidenceModal()">수정</button>
    </div>
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      ${renderThresholdsBody(view.thresholds, view.dailyRecommendCapDefault, view.dailyRecommendCapAbsoluteMax)}
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditThresholdsModal()">수정</button>
    </div>
  `;
  }catch(err){ el.innerHTML = `<div class="section">${escapeHtml(err.message)}</div>`; }
}
```

주의: 이 교체로 카드 렌더링(공통40점/직무60점 두 카드의 `<div class="grid4">...</div>` 부분)은 `renderPointsListBody`를 쓰지 않고 기존 인라인 코드를 그대로 유지한다(합계 표시 위치가 헤더 안이라 `renderPointsListBody`의 "합계" 줄과 중복되기 때문) — `renderPointsListBody`는 `renderPolicyDiff`의 비교 화면에서만 쓰인다. 근거수준/임계값 카드는 헤더에 합계 표시가 없어서 `renderEvidenceBody`/`renderThresholdsBody`를 그대로 메인 카드에도 재사용한다.

- [ ] **Step 4: 적용하기/초안 버리기 함수 추가**

`saveThresholds` 함수가 끝나는 `}` 바로 다음에 추가:

```js
function openApplyDraftModal(){
  showModal(`
    <h3>초안 적용</h3>
    <div class="field"><label>변경 사유</label><input id="f-apply-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="apply-draft-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="applyDraftNow()">적용</button></div>
  `);
}
async function applyDraftNow(){
  const changeReason = document.getElementById('f-apply-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/draft/apply', {changeReason}); }
  catch(err){
    const box = document.getElementById('apply-draft-error');
    box.textContent = err.message; box.style.display = 'block';
    return;
  }
  closeModal();
  await loadAndRenderTalentSearchPolicy();
}
function discardDraftConfirm(){
  if(!confirm('초안을 버릴까요? 지금까지 고친 내용이 전부 사라지고, 되돌릴 수 없어요.')) return;
  discardDraftNow();
}
async function discardDraftNow(){
  try{ await apiDelete('/talent-search-policy/draft'); }
  catch(err){ alert(err.message); return; }
  await loadAndRenderTalentSearchPolicy();
}
```

- [ ] **Step 5: 수동 확인 — 화면에서 전체 흐름**

Run: 로컬 dev 서버, ADMIN 테스트 계정으로 로그인 → 인재검색 → 기준 관리센터. 브라우저 콘솔에 에러 없는지 매 단계 확인.

1. 초안이 없는 상태 확인(배너 없음). Level1 카드 "수정" → 모달에 "변경 사유" 입력칸이 **없는지** 확인 → 아무 값이나 하나 바꿔서 저장.
2. 저장 후 화면 위에 "수정 중인 초안이 있어요 (버전 N, 아직 적용 안 됨)" 배너가 뜨고, 그 아래 "1차 필터(Level 1) 기준"만 "기존 → 초안" 비교로 나오는지 확인(다른 카드는 안 바꼈으니 비교 목록에 안 보임).
3. 공통 40점 카드도 이어서 "수정"으로 값을 바꿔 저장 → 배너의 버전 번호가 **그대로**인지 확인(같은 초안에 병합됐는지 — 새 초안이 또 안 생겼는지), 비교 목록에 "1차 필터"와 "공통 적합도 40점" 둘 다 나오는지 확인.
4. **[초안 버리기]** 클릭 → 확인창 → 버린 후 배너가 사라지고 카드들이 원래 값(1번에서 바꾸기 전 값)으로 돌아오는지 확인.
5. 다시 아무 카드 하나를 고쳐 초안을 만들고, 이번엔 **[적용하기]** 클릭 → 모달에서 변경사유 입력 없이 저장 시도 → "변경 사유를 입력해주세요" 에러 확인 → 사유 입력 후 저장 → 배너 사라지고 "현재 적용 중 · 버전"이 올라가며 바뀐 값이 반영됨.
6. 페이지 새로고침 후에도 적용된 값이 유지되는지 확인.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: 기준 관리센터에 초안 배너·기존/초안 비교·적용하기·초안 버리기 UI 추가, 카드별 변경사유 입력칸 제거"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 "포함" 항목(저장=초안 병합, 적용=changeReason 1회+승격, 버리기, 배너+비교 화면)이 전부 Task 1~3에 매핑됨. "포함 안 함"(버전이력 목록/복구, 가상후보 미리보기)은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음 — 모든 Step에 실제 코드/명령/기대결과가 포함됨.
- **타입/이름 일관성**: `getDraftPolicy`/`saveDraftOverrides`/`applyDraft`/`discardDraft`가 Task 1의 export 선언과 Task 2 핸들러들의 import에서 동일하게 유지됨. `tsPolicy`(카드 렌더링/편집 대상)와 `tsActivePolicy`(비교용 활성 버전)가 Task 3 안에서 일관되게 구분돼 쓰임. `renderLevel1Body`/`renderPointsListBody`/`renderEvidenceBody`/`renderThresholdsBody` 함수명이 Step 2 정의와 Step 3(메인 카드+`renderPolicyDiff`) 양쪽에서 동일하게 참조됨.
- **회귀 방지 확인**: Task 1에서 `createPolicyVersion`을 제거하지만 그 함수를 직접 테스트하는 파일이 없음(grep으로 확인) — 순수 로직 테스트(`node --test`, 48개)는 이번에 건드리지 않은 `talentSearchPolicyValidate.js`만 대상이라 그대로 통과해야 한다(Task 1 Step 3).

## 실행 순서 안내

Task 1(백엔드 초안 로직) → Task 2(적용/버리기 API + GET 확장, Task 1 필요) → Task 3(화면, Task 2의 API 필요) 순서로 진행.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 카드 수정 → 초안 배너/비교 → 적용하기 → 반영까지, 그리고 초안 버리기까지 전체 흐름 화면 캡처
2. 각 Task의 수동 확인 절차 통과 결과, 기존 단위테스트(48개) 회귀 없음 확인 결과
3. 다음 단계(1B-4b: 버전 이력 목록 + 이전 버전으로 복구) 착수 여부
