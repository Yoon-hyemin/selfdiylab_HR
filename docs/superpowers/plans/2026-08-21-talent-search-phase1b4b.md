# 인재검색 Phase 1B-4b (버전 이력 + 복구) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "인재검색" 화면에 새 서브탭 "버전 이력"을 추가해서 과거로 밀려난(superseded) 정책 버전들을 누가/언제/왜 바꿨는지 볼 수 있게 하고, 그중 하나를 골라 초안으로 다시 불러오는("복구") 기능을 만든다.

**Architecture:** `handlers/_lib/talentSearchPolicy.js`에 두 함수를 추가한다 — `listPolicyVersions(limit)`(초안 제외, 최신순, 변경자 이름 조인) / `restoreVersionAsDraft(versionId, actorAccountId)`(대상 버전의 값을 그대로 새 초안으로 만들되, 기존 초안이 있으면 먼저 지움). 두 함수 다 새 초안 INSERT 로직을 공유해야 해서, `saveDraftOverrides`의 기존 INSERT 분기를 `insertNewDraft(base, actorAccountId)` 내부 헬퍼로 뽑아 재사용한다. 새 엔드포인트 2개(`GET .../versions`, `PATCH .../versions/:id/restore`)와 `policy_out`에 `id` 필드 추가(복구 버튼이 행의 uuid를 알아야 해서). 프론트는 "대시보드"/"기준 관리센터" 옆에 세 번째 서브탭 "버전 이력"을 추가하고, 표로 목록을 보여주고 과거 행에만 "복구" 버튼을 단다.

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`(`sql`).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-21-talent-search-phase1b4b-design.md` — 정확한 동작/API 모양은 이 문서에서 그대로 가져온다.
- 스키마 변경 없음 — 필요한 컬럼(`version_no`/`status`/`change_reason`/`created_by`/`applied_at`)이 이미 다 있다.
- 목록은 **초안(`status='draft'`) 제외**, **최근 50개**만, `version_no` 내림차순.
- "복구" = 그 버전의 필드값을 그대로 새 초안으로 만드는 것(즉시 활성화 아님) — 만들어진 초안은 1B-4a의 기존 배너/비교/적용 흐름으로 이어서 검토한다.
- **복구 시 기존 초안이 있으면 병합이 아니라 통째로 덮어쓴다**(먼저 지우고 새로 만듦).
- "변경한 사람" 표시는 `handlers/audit-log/index.js`가 이미 쓰는 조인 패턴을 그대로 재사용한다: `accounts.id = created_by` → `accounts.employee_id = members.id` → `members.name`, 이름 없으면 `'(알 수 없음)'`.
- 모든 엔드포인트는 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님, 기존과 동일).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에 반드시 등록한다. 패턴: `['talent-search-policy','versions']`(GET, 2세그먼트), `['talent-search-policy','versions',':id','restore']`(PATCH, 4세그먼트) — 기존 라우트들과 세그먼트 수/리터럴이 달라 충돌 없음.
- 이 프로젝트는 순수 계산 로직만 `node --test`로 단위테스트하고, DB/HTTP/UI는 로컬 dev 서버로 수동 검증한다. 이번 작업은 DB를 직접 다루는 함수/엔드포인트와 화면뿐이라 새 자동 테스트는 추가하지 않는다(기존 48개 테스트는 이 파일들을 대상으로 하지 않으므로 그대로 통과해야 함 — 회귀 확인용으로 실행).
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다.
- 테스트 계정: `preview-test@selfdiylab.invalid` / `Preview1234` (ADMIN).

---

### Task 1: 버전 이력 조회 + 복구 백엔드 (함수 + 엔드포인트 2개)

**Files:**
- Modify: `handlers/_lib/talentSearchPolicy.js`
- Create: `handlers/talent-search-policy/versions/index.js`
- Create: `handlers/talent-search-policy/versions/[id]/restore.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Produces: `handlers/_lib/talentSearchPolicy.js`가 추가로 `export async function listPolicyVersions(limit)`(초안 제외 최근 `limit`개, 각 행에 `created_by_name` 포함, snake_case 그대로 반환), `export async function restoreVersionAsDraft(versionId, actorAccountId)`(대상 버전 행 그대로를 새 초안으로 만들어 반환, 대상이 없으면 `'복구할 버전을 찾을 수 없어요'` 에러)를 export. `policy_out(row)`가 이제 응답에 `id` 필드도 포함(기존 호출부 전부에 하위호환 — 필드가 늘어날 뿐 기존 필드는 그대로).

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
 * 활성 버전을 베이스로 새 초안 행을 만든다. 1B-4b부터는 여기에 버전 이력
 * 조회(listPolicyVersions)와 과거 버전 복구(restoreVersionAsDraft)가 추가된다
 * -- 복구도 "새 초안 만들기"라 saveDraftOverrides와 INSERT 로직을 공유한다
 * (insertNewDraft).
 */
import { sql } from './db.js';
import { requireTalentSearchAccess } from './accountAuth.js';
import { validateOverrideKeys } from './talentSearchPolicyValidate.js';

export function policy_out(row) {
  return {
    id: row.id,
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

// base(snake_case row 모양)의 필드값을 그대로 복사해 새 초안 행을 INSERT한다
// (version_no는 현재 최댓값+1). saveDraftOverrides(초안이 아직 없을 때)와
// restoreVersionAsDraft가 이 로직을 공유한다.
async function insertNewDraft(base, actorAccountId) {
  const [maxRow] = await sql`SELECT MAX(version_no) AS max FROM talent_search_policy_versions`;
  const nextVersionNo = (maxRow.max || 0) + 1;
  const [inserted] = await sql`
    INSERT INTO talent_search_policy_versions (
      version_no, level1_rules, common_fit_weights, evidence_coefficients,
      job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
      daily_recommend_cap_default, daily_recommend_cap_absolute_max,
      data_retention_months, status, created_by
    ) VALUES (
      ${nextVersionNo}, ${JSON.stringify(base.level1_rules)}::jsonb,
      ${JSON.stringify(base.common_fit_weights)}::jsonb, ${JSON.stringify(base.evidence_coefficients)}::jsonb,
      ${JSON.stringify(base.job_fit_default_weights)}::jsonb, ${JSON.stringify(base.rounding_rule)}::jsonb,
      ${JSON.stringify(base.thresholds)}::jsonb, ${JSON.stringify(base.sort_tiebreak_rules)}::jsonb,
      ${base.daily_recommend_cap_default}, ${base.daily_recommend_cap_absolute_max},
      ${base.data_retention_months}, 'draft', ${actorAccountId}
    ) RETURNING *`;
  return inserted;
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

  return insertNewDraft(next, actorAccountId);
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
        RETURNING *`,
    // saveDraftOverrides는 초안이 있으면 UPDATE, 없으면 INSERT하는
    // check-then-act라 DB 유니크 제약이 없다 -- 동시에 첫 저장이 두 번
    // 들어오는 극히 드문 경우엔 초안 행이 두 개 생길 수 있다. 그 상태에서
    // 방금 승격한 것 말고 다른 draft 행이 남아있으면 영구히 고아 초안으로
    // 남아 배너가 계속 뜨고, 다음 카드 저장이 그 고아 행에 병합돼버린다.
    // 정상 케이스(초안이 늘 하나뿐)에서는 대상이 없어 아무 효과가 없는
    // 순수 보험용 삭제문이다.
    sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft' AND id <> ${draft.id}`
  ]);
  return result[1][0];
}

export async function discardDraft() {
  await sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft'`;
}

// 특정 버전(과거든 활성이든)의 값을 그대로 복구해 새 초안으로 만든다. 이미
// 초안이 있었다면 통째로 덮어쓴다(saveDraftOverrides처럼 이어서 병합하는 게
// 아니라, "이 시점 스냅샷으로 완전히 교체"가 목적이라서다 -- 사용자가
// 명시적으로 확인한 동작).
export async function restoreVersionAsDraft(versionId, actorAccountId) {
  const [target] = await sql`SELECT * FROM talent_search_policy_versions WHERE id = ${versionId}`;
  if (!target) throw new Error('복구할 버전을 찾을 수 없어요');

  await sql`DELETE FROM talent_search_policy_versions WHERE status = 'draft'`;
  return insertNewDraft(target, actorAccountId);
}

// 최근 limit개 버전(초안 제외)을 변경자 이름과 함께 최신순으로 조회한다.
// 이름 조인은 handlers/audit-log/index.js가 이미 쓰는 accounts->members
// 패턴과 동일 -- accounts에는 이름이 없고 members에 있어서 두 단계로 탄다.
export async function listPolicyVersions(limit) {
  const rows = await sql`
    SELECT v.*, m.name AS created_by_name
    FROM talent_search_policy_versions v
    LEFT JOIN accounts a ON a.id = v.created_by
    LEFT JOIN members m ON m.id = a.employee_id
    WHERE v.status != 'draft'
    ORDER BY v.version_no DESC
    LIMIT ${limit}`;
  return rows;
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

- [ ] **Step 2: 목록 조회 핸들러 작성**

```js
// handlers/talent-search-policy/versions/index.js
/**
 * handlers/talent-search-policy/versions/index.js
 *
 * GET -> 200 { versions: [{ id, versionNo, status, appliedAt, changeReason,
 *              createdAt, createdByName, level1Rules, commonFitWeights,
 *              evidenceCoefficients, jobFitDefaultWeights, roundingRule,
 *              thresholds, sortTiebreakRules, dailyRecommendCapDefault,
 *              dailyRecommendCapAbsoluteMax, dataRetentionMonths }, ...] }
 *
 * 1B-4b: 최근 50개 버전(초안 제외) 이력을 최신순으로 반환한다. 각 행에
 * 정책 필드 전체를 포함하는 이유는 "복구" 버튼을 눌렀을 때 화면이 그 값을
 * 다시 조회하지 않고도 쓸 수 있게 하기 위해서다(행 수·필드 크기 모두 작아
 * 응답 크기 문제는 없다).
 */
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { listPolicyVersions, policy_out } from '../../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const rows = await listPolicyVersions(50);
    return res.status(200).json({
      versions: rows.map(r => ({ ...policy_out(r), createdByName: r.created_by_name || '(알 수 없음)' }))
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '버전 이력을 불러오지 못했어요' });
  }
}
```

- [ ] **Step 3: 복구 핸들러 작성**

```js
// handlers/talent-search-policy/versions/[id]/restore.js
/**
 * handlers/talent-search-policy/versions/[id]/restore.js
 *
 * PATCH /api/talent-search-policy/versions/:id/restore
 * Body 없음 -> 200 { ...policy_out 응답(새로 만들어진 초안) }
 *
 * 1B-4b: 과거(또는 활성) 버전 하나를 골라 그 값 그대로 초안으로 복구한다.
 * 이미 초안이 있었다면 통째로 덮어쓴다(1B-4a의 카드별 저장처럼 이어서
 * 병합하는 게 아니라, "이 시점 스냅샷으로 완전히 교체"가 목적이라서다 --
 * 사용자가 명시적으로 확인한 동작).
 */
import { requireTalentSearchAccess } from '../../../_lib/accountAuth.js';
import { restoreVersionAsDraft, policy_out } from '../../../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  try {
    const restored = await restoreVersionAsDraft(id, account.id);
    return res.status(200).json(policy_out(restored));
  } catch (err) {
    if (err.message === '복구할 버전을 찾을 수 없어요') return res.status(404).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: '버전 복구에 실패했어요' });
  }
}
```

- [ ] **Step 4: 라우트 등록**

`api/[...path].js`의 `talentSearchPolicyDraftApply` import 줄 다음에 추가:

```js
import talentSearchPolicyVersions from '../handlers/talent-search-policy/versions/index.js';
import talentSearchPolicyVersionRestore from '../handlers/talent-search-policy/versions/[id]/restore.js';
```

`ROUTES` 배열의 `talent-search-policy/draft/apply` 항목 다음에 추가:

```js
  { pattern: ['talent-search-policy', 'versions'], handler: talentSearchPolicyVersions },
  { pattern: ['talent-search-policy', 'versions', ':id', 'restore'], handler: talentSearchPolicyVersionRestore },
```

- [ ] **Step 5: 기존 단위테스트 회귀 확인**

Run: `node --test`
Expected: 48개 전부 PASS(이 Task는 이 테스트들이 다루는 파일을 건드리지 않음 — 회귀 확인용).

- [ ] **Step 6: 수동 확인 — 목록 조회 + 복구 전체 흐름**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), ADMIN 테스트 계정으로 로그인한 쿠키로:

```bash
curl -s -c cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"preview-test@selfdiylab.invalid","password":"Preview1234"}'
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy > before.json
node -e "const p=require('./before.json'); console.log('활성 versionNo:', p.versionNo, 'id:', p.id, 'passWithinDays:', p.level1Rules.resumeUpdated.passWithinDays); console.log('draft:', p.draft);"
```
Expected: `draft: null`(초안 없음 확인), 활성 버전의 `id`/`versionNo`/`passWithinDays` 값을 기록해둔다(이후 단계에서 `OLD_ID`/`P0`로 부름).

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy/versions
```
Expected: `{"versions":[...]}`, 배열의 각 항목에 `id`/`versionNo`/`status`/`createdByName`/`changeReason` 등이 있고, `status:"draft"`인 항목은 하나도 없음(지금 초안이 없으므로 애초에 검증 불가 — 코드 리뷰로 `WHERE v.status != 'draft'`가 있는지 다시 한번 확인). 맨 위 항목의 `id`가 방금 `before.json`에서 본 활성 버전의 `id`와 같은지 확인(최신순 정렬 확인).

```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/level1-rules -H "Content-Type: application/json" -d '{"level1Rules":{"resumeUpdated":{"passWithinDays":77,"verifyWithinDays":180},"shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,"exceptions":["인턴"]},"careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}}'
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/draft/apply -H "Content-Type: application/json" -d '{"changeReason":"1B-4b 수동 확인 -- 77일로 임시 변경"}'
```
Expected: 두 번째 응답 `200`, `passWithinDays:77`이 새 활성 버전으로 반영됨(이제 앞서 기록해둔 `OLD_ID` 버전은 superseded로 밀려남).

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy/versions
```
Expected: `OLD_ID`에 해당하는 항목이 이제 `"status":"superseded"`로 보임, 방금 적용한 새 버전이 목록 맨 위에 `"status":"active"`로 보임.

```bash
curl -s -b cookies.txt -X PATCH "http://localhost:3000/api/talent-search-policy/versions/OLD_ID/restore" -H "Content-Type: application/json" -d '{}'
```
(`OLD_ID`를 실제 값으로 바꿔서 실행) Expected: `200`, 응답의 `status:"draft"`, `passWithinDays`가 원래 값 `P0`로 돌아와 있음(복구한 그 과거 버전의 값 그대로).

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: `draft`에 `passWithinDays:P0`가 들어있고, 최상위(활성) `level1Rules.resumeUpdated.passWithinDays`는 여전히 `77`(복구가 활성 버전을 바로 바꾸지 않음 확인).

이제 "복구가 기존 초안을 덮어쓰는지" 확인:
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/level1-rules -H "Content-Type: application/json" -d '{"level1Rules":{"resumeUpdated":{"passWithinDays":55,"verifyWithinDays":180},"shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,"exceptions":["인턴"]},"careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}}'
```
(지금 초안이 있는 상태에서 또 카드 저장 — 이건 병합이라 초안의 `passWithinDays`가 `55`로 바뀜)
```bash
curl -s -b cookies.txt -X PATCH "http://localhost:3000/api/talent-search-policy/versions/OLD_ID/restore" -H "Content-Type: application/json" -d '{}'
```
Expected: `200`, `passWithinDays`가 다시 `P0`로 돌아옴(방금 만든 `55` 값의 초안이 살아남지 않고, 복구가 통째로 덮어썼음 확인 — 병합이 아니라 교체).

마지막으로 정리(원래 활성 값 `P0`로 되돌려서 DB를 깨끗하게 유지):
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/draft/apply -H "Content-Type: application/json" -d '{"changeReason":"1B-4b 수동 확인 정리 -- 원래 값으로 복귀"}'
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: 최상위 `level1Rules.resumeUpdated.passWithinDays`가 `P0`(원래 값)로 돌아옴, `draft:null`.

- [ ] **Step 7: Commit**

```bash
git add "handlers/_lib/talentSearchPolicy.js" "handlers/talent-search-policy/versions/index.js" "handlers/talent-search-policy/versions/[id]/restore.js" "api/[...path].js"
git commit -m "feat: 인재검색 정책 버전 이력 조회(GET versions)·과거 버전 복구(PATCH versions/:id/restore) 엔드포인트 추가"
```

---

### Task 2: 화면 — "버전 이력" 서브탭 + 목록 표 + 복구 버튼

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 1의 `GET /talent-search-policy/versions`, `PATCH /talent-search-policy/versions/:id/restore`
- Produces: 없음(화면 종단). `loadAndRenderTalentSearchVersions()`, `restoreVersionConfirm(id, versionNo)`/`restoreVersionNow(id)`가 새로 생김.

- [ ] **Step 1: 세 번째 서브탭 버튼 + 컨테이너 추가**

현재:

```html
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
      </div>
      <div id="talentsearch-dashboard">
```

이걸 아래로 교체:

```html
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
        <button class="tab" onclick="switchTalentSearchTab('versions')" id="tstab-versions">버전 이력</button>
      </div>
      <div id="talentsearch-dashboard">
```

같은 영역에서 현재:

```html
      <div id="talentsearch-policy" style="display:none;">
        <div id="talentsearch-policy-body"></div>
      </div>
    </div>
```

이걸 아래로 교체:

```html
      <div id="talentsearch-policy" style="display:none;">
        <div id="talentsearch-policy-body"></div>
      </div>
      <div id="talentsearch-versions" style="display:none;">
        <div id="talentsearch-versions-body"></div>
      </div>
    </div>
```

- [ ] **Step 2: `switchTalentSearchTab`이 세 번째 탭을 다루도록 수정**

현재:

```js
function switchTalentSearchTab(tab){
  ['dashboard','policy'].forEach(t=>{
    document.getElementById('talentsearch-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('tstab-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='policy') loadAndRenderTalentSearchPolicy();
}
```

이걸 아래로 교체:

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

- [ ] **Step 3: 목록 렌더링 + 복구 함수 추가**

`discardDraftNow` 함수가 끝나는 `}` 바로 다음(빈 줄 하나 있고 `function renderTalentSearchDashboard(){` 시작 전)에 추가:

```js
async function loadAndRenderTalentSearchVersions(){
  const el = document.getElementById('talentsearch-versions-body');
  if(!el) return;
  el.innerHTML = '불러오는 중...';
  try{
    const { versions } = await apiGet('/talent-search-policy/versions');
    el.innerHTML = `
      <div class="section">
        <div class="section-head"><div><h3>버전 이력</h3><div class="desc">최근 ${versions.length}개 (초안은 여기 안 보여요 -- 기준 관리센터에서 확인)</div></div></div>
        <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>버전</th><th>상태</th><th>적용일시</th><th>변경한 사람</th><th>변경사유</th><th></th></tr></thead>
          <tbody>
            ${versions.map(v=>`
              <tr>
                <td>${v.versionNo}</td>
                <td>${v.status==='active' ? '<span class="badge green">현재 적용 중</span>' : '<span class="badge grey">과거</span>'}</td>
                <td>${v.appliedAt ? new Date(v.appliedAt).toLocaleString('ko-KR') : '-'}</td>
                <td>${escapeHtml(v.createdByName)}</td>
                <td>${escapeHtml(v.changeReason || '-')}</td>
                <td>${v.status!=='active' ? `<button class="btn ghost sm" onclick="restoreVersionConfirm('${v.id}', ${v.versionNo})">복구</button>` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      </div>
    `;
  }catch(err){ el.innerHTML = `<div class="section">${escapeHtml(err.message)}</div>`; }
}
function restoreVersionConfirm(id, versionNo){
  if(!confirm(`버전 ${versionNo}의 내용을 초안으로 불러올까요? 지금 작성 중인 초안이 있다면 사라지고 이 버전 내용으로 덮어써요.`)) return;
  restoreVersionNow(id);
}
async function restoreVersionNow(id){
  try{ await apiPatch(`/talent-search-policy/versions/${id}/restore`, {}); }
  catch(err){ alert(err.message); return; }
  switchTalentSearchTab('policy');
}
```

- [ ] **Step 4: 수동 확인 — 화면에서 목록 + 복구**

Run: 로컬 dev 서버, ADMIN 테스트 계정으로 로그인 → 인재검색 → "버전 이력" 탭. 브라우저 콘솔 에러 없는지 매 단계 확인.

1. 표가 뜨고, 최상단 행이 "현재 적용 중" 배지, 나머지는 "과거" 배지인지 확인. "현재 적용 중" 행에는 "복구" 버튼이 없고, 과거 행에는 있는지 확인.
2. 과거 행 하나의 "복구" 클릭 → 확인창 문구에 그 버전 번호가 들어있는지 확인 → 확인 누르면 자동으로 "기준 관리센터" 탭으로 전환되고, 1B-4a에서 만든 "수정 중인 초안이 있어요" 배너 + "기존→초안" 비교가 뜨는지 확인(그 과거 버전 값과 지금 활성 값이 다른 카드만 비교로 나옴).
3. 그 초안을 "초안 버리기"로 지운 뒤(1B-4a 기능), "버전 이력" 탭으로 다시 가서 표가 그대로인지(변화 없음) 확인.
4. 아무 카드나 "수정"으로 값을 하나 바꿔 초안을 만든 상태에서, "버전 이력" 탭으로 이동 → 다른 과거 행의 "복구" 클릭 → 확인 → 기준 관리센터로 이동했을 때 방금 만든 초안(카드 수정분)이 아니라 복구한 과거 버전의 값으로 배너/비교가 뜨는지 확인(덮어쓰기 확인).
5. 이 초안도 정리(적용하거나 버리기)해서 화면과 DB를 원래 상태로 되돌려놓는다.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: 인재검색 기준 관리센터에 버전 이력 서브탭·복구 버튼 추가"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 "포함" 항목(버전 이력 목록 API+화면, 복구 API+버튼, 복구 시 기존 초안 덮어쓰기 확인)이 전부 Task 1~2에 매핑됨. "포함 안 함"(가상 후보 미리보기)은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음 — 모든 Step에 실제 코드/명령/기대결과가 포함됨.
- **타입/이름 일관성**: `listPolicyVersions`/`restoreVersionAsDraft`/`insertNewDraft`가 Task 1의 export 선언과 두 핸들러 파일의 import에서 동일하게 유지됨. `policy_out`에 추가된 `id` 필드가 Task 1의 두 새 핸들러(응답에 `id` 필요)와 Task 2의 프론트(복구 버튼이 `v.id` 사용)에서 일관되게 쓰임. `loadAndRenderTalentSearchVersions`/`restoreVersionConfirm`/`restoreVersionNow` 함수명이 Task 2 Step 2(탭 전환)와 Step 3(정의)에서 일치.
- **회귀 방지 확인**: `policy_out`에 `id` 필드를 추가하는 변경이 기존 5개 카드 응답과 `GET /talent-search-policy`/`draft`/`apply` 응답 모양에 필드 하나를 추가할 뿐 기존 필드는 그대로 유지하므로 하위호환 — Task 1 Step 5(기존 48개 테스트)로 다른 회귀가 없는지 확인.

## 실행 순서 안내

Task 1(백엔드 함수+엔드포인트) → Task 2(화면, Task 1의 API 필요) 순서로 진행.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 "버전 이력" 탭 화면 캡처, 과거 버전 하나를 복구해서 기준 관리센터의 배너/비교로 이어지는 흐름 캡처
2. 각 Task의 수동 확인 절차 통과 결과, 기존 단위테스트(48개) 회귀 없음 확인 결과
3. 다음 단계(1B-4c: 가상 후보 3명 미리보기) 착수 여부
