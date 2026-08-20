# 인재검색 Phase 1B-3 (직무60점 + 근거수준 + 임계값·하루상한 수정 가능) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "기준 관리센터"의 남은 세 카드(직무 적합도 60점 기본 배점, 근거수준별 점수, 추천 임계값·하루 추천상한)를 실제로 수정 가능하게 만든다. 이걸로 기준 관리센터의 모든 카드가 읽기전용에서 벗어난다.

**Architecture:** 검증 함수를 DB 의존성 없는 새 파일(`handlers/_lib/talentSearchPolicyValidate.js`)로 모으고, `handlers/_lib/talentSearchPolicy.js`에 "메서드검사→권한검사→changeReason검사→검증→조회→새버전생성→응답"을 한 번에 처리하는 공용 팩토리(`makePolicyPatchHandler`)를 추가한다. 기존 2개 핸들러(Level1/공통40점)도 이 팩토리를 쓰도록 옮기고, 새 3개 핸들러(직무60점/근거수준/임계값+하루상한)도 같은 방식으로 만든다. 프론트는 공통40점 모달을 "항목 배열+합계검증" 범용 모달로 일반화해서 직무60점과 같이 쓰고, 근거수준/임계값은 각각 전용 모달을 새로 추가한다.

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`(`sql.transaction`), 순수 SQL, `node --test`.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-20-talent-search-phase1b3-design.md` — 정확한 검증 규칙·API 모양은 이 문서에서 그대로 가져온다.
- 수정 = 새 버전 즉시 생성+적용(초안 없음). 기존 활성 버전은 `status='superseded'`로, 새 행은 `version_no = 기존+1`, `status='active'`로 INSERT — `createPolicyVersion`(이미 존재, 변경 없음)이 처리.
- 모든 PATCH 엔드포인트는 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에도 반드시 등록한다.
- 직무 60점 항목: 공통 40점과 동일하게 개수 자유(최소 1개), 배점 합계 정확히 60, `key` 중복 불가·정체성 유지.
- 근거수준별 점수(`evidenceCoefficients`): 저장 형식은 0~1 소수 그대로 유지(화면에서만 %로 보여주고 입력받음). `none ≤ weak ≤ partial ≤ clear` 순서, 모두 0보다 크고 1 이하.
- 임계값(`thresholds.totalScoreMin` 0~100, `thresholds.jobFitScoreMin` 0~60, `thresholds.minMeaningfulEvidenceCount` 1 이상)과 하루 추천상한(`dailyRecommendCapDefault`/`dailyRecommendCapAbsoluteMax` 둘 다 1 이상 정수, 기본값이 절대상한을 넘을 수 없음)은 하나의 PATCH 엔드포인트(`/thresholds`)로 같이 처리 — 화면에서도 한 카드로 같이 표시되고 있어서.
- 이 프로젝트는 순수 계산 로직만 `node --test`로 단위테스트하고, DB/HTTP/UI 통합 작업은 로컬 dev 서버 브라우저 수동 검증으로 확인한다(1B-2와 동일 원칙). 검증 함수(`validate*`)는 DB/HTTP 없는 순수 함수라 이 원칙에 따라 단위테스트를 추가한다.
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖.
- `handlers/_lib/db.js`는 `DATABASE_URL`이 없으면 모듈 로드 시점에 throw한다 — 그래서 검증 함수는 `db.js`를 (직접도, 간접도) import하지 않는 파일에 둬야 `DATABASE_URL` 없이도 단위테스트가 돌아간다.

---

### Task 1: 검증 로직 분리 + 공용 PATCH 팩토리 + 기존 2개 핸들러 리팩터

**Files:**
- Create: `handlers/_lib/talentSearchPolicyValidate.js`
- Modify: `handlers/_lib/talentSearchPolicy.js`
- Modify: `handlers/talent-search-policy/level1-rules.js`
- Modify: `handlers/talent-search-policy/common-fit-weights.js`
- Modify: `handlers/talent-search-policy/level1-rules.test.js`
- Modify: `handlers/talent-search-policy/common-fit-weights.test.js`

**Interfaces:**
- Produces: `handlers/_lib/talentSearchPolicyValidate.js`가 `export function validateLevel1Rules(l1)`, `export function validateCommonFitWeights(items)`, `export function validateJobFitDefaultWeights(items)`를 export (뒤 둘은 내부적으로 `validatePointsList(items, expectedSum)` 공유, 이 함수는 export 안 함). `handlers/_lib/talentSearchPolicy.js`가 추가로 `export function makePolicyPatchHandler({ validate, buildOverrides })`를 export — `validate(body)`는 `req.body`에서 `changeReason`을 뺀 나머지를 받아 에러 문자열 또는 `null` 반환, `buildOverrides(body)`는 그 `body`를 `createPolicyVersion`에 넘길 snake_case 필드 객체로 변환. Task 2/3/4가 이 팩토리와 새 validate 함수를 그대로 사용한다.

- [ ] **Step 1: 검증 로직 전용 파일 작성 (job-fit-weights 몫까지 미리 포함)**

```js
// handlers/_lib/talentSearchPolicyValidate.js
/**
 * 인재검색 채점 정책의 각 필드별 검증 함수. DB/HTTP를 import하지 않는
 * 순수 함수만 모아둔다 -- handlers/_lib/db.js는 DATABASE_URL이 없으면
 * 모듈 로드 시점에 throw하므로, 검증 로직을 핸들러 파일 안에 두면
 * DATABASE_URL 없이는 순수 로직 단위테스트조차 돌릴 수 없었다(1B-2까지의
 * 알려진 한계). 이 파일은 그 문제를 해소하기 위해 분리했다.
 */

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
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

function validatePointsList(items, expectedSum) {
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
  if (sum !== expectedSum) return `배점 합계가 ${expectedSum}점이어야 해요 (지금 합계: ${sum}점)`;
  return null;
}

export function validateCommonFitWeights(items) {
  return validatePointsList(items, 40);
}

export function validateJobFitDefaultWeights(items) {
  return validatePointsList(items, 60);
}

function isFractionInRange(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;
}

export function validateEvidenceCoefficients(ec) {
  if (!ec || typeof ec !== 'object') return '값이 올바르지 않아요';
  const { none, weak, partial, clear } = ec;
  if (![none, weak, partial, clear].every(isFractionInRange)) return '근거수준별 점수는 0보다 크고 100% 이하의 값이어야 해요';
  if (!(none <= weak && weak <= partial && partial <= clear)) return '명확 ≥ 부분 ≥ 약함 ≥ 없음 순서를 지켜야 해요';
  return null;
}

export function validateThresholdsAndCaps(body) {
  const t = body && body.thresholds;
  if (!t || typeof t !== 'object') return '값이 올바르지 않아요';
  if (!isNonNegativeInt(t.totalScoreMin) || t.totalScoreMin > 100) return '총점 기준은 0~100 사이 정수여야 해요';
  if (!isNonNegativeInt(t.jobFitScoreMin) || t.jobFitScoreMin > 60) return '직무점수 기준은 0~60 사이 정수여야 해요';
  if (!isPositiveInt(t.minMeaningfulEvidenceCount)) return '의미있는 근거 개수는 1 이상의 정수여야 해요';
  if (!isPositiveInt(body.dailyRecommendCapDefault)) return '하루 추천상한 기본값은 1 이상의 정수여야 해요';
  if (!isPositiveInt(body.dailyRecommendCapAbsoluteMax)) return '하루 추천상한 절대값은 1 이상의 정수여야 해요';
  if (body.dailyRecommendCapDefault > body.dailyRecommendCapAbsoluteMax) return '하루 추천상한 기본값은 절대상한을 넘을 수 없어요';
  return null;
}
```

- [ ] **Step 2: 공용 PATCH 팩토리를 `handlers/_lib/talentSearchPolicy.js`에 추가**

파일 맨 위 import에 `requireTalentSearchAccess` 추가 (기존 `import { sql } from './db.js';` 바로 다음 줄):

```js
import { requireTalentSearchAccess } from './accountAuth.js';
```

파일 맨 끝(`createPolicyVersion` 함수 다음)에 추가:

```js
// validate(body): body(= req.body에서 changeReason을 뺀 나머지)를 검사해 에러 메시지
// 문자열 또는 null 반환. buildOverrides(body): body를 createPolicyVersion에 넘길
// snake_case 필드 객체로 변환.
export function makePolicyPatchHandler({ validate, buildOverrides }) {
  return async function handler(req, res) {
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

    const account = await requireTalentSearchAccess(req, res);
    if (!account) return;

    const { changeReason, ...body } = req.body || {};
    if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });
    const validationError = validate(body);
    if (validationError) return res.status(400).json({ error: validationError });

    try {
      const current = await getActivePolicy();
      if (!current) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
      const updated = await createPolicyVersion(current, buildOverrides(body), account.id, changeReason.trim());
      return res.status(200).json(policy_out(updated));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '기준 수정에 실패했어요' });
    }
  };
}
```

- [ ] **Step 3: `level1-rules.js`를 팩토리 사용으로 교체**

`handlers/talent-search-policy/level1-rules.js` 전체를 아래로 교체:

```js
/**
 * handlers/talent-search-policy/level1-rules.js
 *
 * PATCH { level1Rules: {...}, changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 검증 로직은 handlers/_lib/talentSearchPolicyValidate.js에 있다(1B-3에서
 * DB 비의존 파일로 이전 -- 그 전까지는 이 파일 안에 있어서 DATABASE_URL
 * 없이는 단위테스트도 못 돌렸다).
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateLevel1Rules } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateLevel1Rules(body.level1Rules),
  buildOverrides: (body) => ({ level1_rules: body.level1Rules })
});
```

- [ ] **Step 4: `common-fit-weights.js`를 팩토리 사용으로 교체**

`handlers/talent-search-policy/common-fit-weights.js` 전체를 아래로 교체:

```js
/**
 * handlers/talent-search-policy/common-fit-weights.js
 *
 * PATCH { commonFitWeights: [...], changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 검증 로직은 handlers/_lib/talentSearchPolicyValidate.js에 있다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateCommonFitWeights } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateCommonFitWeights(body.commonFitWeights),
  buildOverrides: (body) => ({ common_fit_weights: body.commonFitWeights })
});
```

- [ ] **Step 5: 기존 테스트 파일의 import 경로만 변경**

`handlers/talent-search-policy/level1-rules.test.js` 3번째 줄:

```js
import { validateLevel1Rules } from '../_lib/talentSearchPolicyValidate.js';
```

`handlers/talent-search-policy/common-fit-weights.test.js` 3번째 줄:

```js
import { validateCommonFitWeights } from '../_lib/talentSearchPolicyValidate.js';
```

(각 파일의 나머지 테스트 코드는 그대로 — import 줄만 바뀐다.)

- [ ] **Step 6: 기존 테스트가 그대로 통과하는지 확인**

Run: `node --test handlers/talent-search-policy/level1-rules.test.js handlers/talent-search-policy/common-fit-weights.test.js`
Expected: 11개 테스트(4+7) 전부 PASS — import 경로만 바뀌었을 뿐 검증 로직은 동일하므로 회귀 없어야 함.

- [ ] **Step 7: 수동 확인 — 리팩터로 API 동작이 안 바뀌었는지**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), ADMIN 테스트 계정(`preview-test@selfdiylab.invalid`/`Preview1234`)으로 로그인한 쿠키로:
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/level1-rules -H "Content-Type: application/json" -d '{"level1Rules":{"resumeUpdated":{"passWithinDays":90,"verifyWithinDays":180},"shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,"exceptions":["인턴"]},"careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}},"changeReason":"1B-3 리팩터 회귀 확인"}'
```
Expected: `200`, `versionNo`가 이전보다 +1(리팩터 전과 동일하게 동작).

- [ ] **Step 8: Commit**

```bash
git add "handlers/_lib/talentSearchPolicyValidate.js" "handlers/_lib/talentSearchPolicy.js" "handlers/talent-search-policy/level1-rules.js" "handlers/talent-search-policy/common-fit-weights.js" "handlers/talent-search-policy/level1-rules.test.js" "handlers/talent-search-policy/common-fit-weights.test.js"
git commit -m "refactor: 인재검색 정책 검증로직 DB비의존 파일로 분리 + PATCH 핸들러 공용 팩토리 도입"
```

---

### Task 2: `PATCH /api/talent-search-policy/job-fit-weights`

**Files:**
- Create: `handlers/talent-search-policy/job-fit-weights.js`
- Test: `handlers/talent-search-policy/job-fit-weights.test.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 `makePolicyPatchHandler`(`../_lib/talentSearchPolicy.js`), `validateJobFitDefaultWeights`(`../_lib/talentSearchPolicyValidate.js`)
- Produces: `PATCH /api/talent-search-policy/job-fit-weights` `{ jobFitDefaultWeights, changeReason }` → `200 { ...policy_out 응답 }`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// handlers/talent-search-policy/job-fit-weights.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJobFitDefaultWeights } from '../_lib/talentSearchPolicyValidate.js';

test('validateJobFitDefaultWeights: 합계 60이면 null', () => {
  const items = [
    { key: 'a', label: '핵심경험', points: 40 },
    { key: 'b', label: '우대조건', points: 20 }
  ];
  assert.equal(validateJobFitDefaultWeights(items), null);
});

test('validateJobFitDefaultWeights: 항목 1개여도 합계만 60이면 통과 (개수 제한 없음)', () => {
  assert.equal(validateJobFitDefaultWeights([{ key: 'only', label: '단일 항목', points: 60 }]), null);
});

test('validateJobFitDefaultWeights: 합계가 60이 아니면 에러', () => {
  const items = [{ key: 'a', label: '항목A', points: 59 }];
  assert.ok(validateJobFitDefaultWeights(items));
});

test('validateJobFitDefaultWeights: 빈 배열이면 에러', () => {
  assert.ok(validateJobFitDefaultWeights([]));
});

test('validateJobFitDefaultWeights: key 중복이면 에러', () => {
  const items = [
    { key: 'dup', label: '항목A', points: 30 },
    { key: 'dup', label: '항목B', points: 30 }
  ];
  assert.ok(validateJobFitDefaultWeights(items));
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `node --test handlers/talent-search-policy/job-fit-weights.test.js`
Expected: FAIL — `validateJobFitDefaultWeights`는 이미 Task 1에서 `talentSearchPolicyValidate.js`에 구현돼 있으므로 실제로는 이 테스트들이 이미 PASS할 것이다. **이 Task의 실제 신규 코드는 핸들러/라우트뿐이므로, 이 Step은 "테스트가 통과함을 재확인"으로 대체한다** — 별도 실패 유도 없이 바로 Step 4로 넘어간다.

- [ ] **Step 3: 핸들러 작성**

```js
// handlers/talent-search-policy/job-fit-weights.js
/**
 * PATCH { jobFitDefaultWeights: [...], changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 1B-3: 직무 적합도 60점 기본 배점 수정. 공통 40점과 동일한 모양(항목
 * 자유 추가/삭제, 합계 정확히 60) -- validateJobFitDefaultWeights가
 * 내부적으로 공통 40점과 같은 validatePointsList를 공유한다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateJobFitDefaultWeights } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateJobFitDefaultWeights(body.jobFitDefaultWeights),
  buildOverrides: (body) => ({ job_fit_default_weights: body.jobFitDefaultWeights })
});
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `node --test handlers/talent-search-policy/job-fit-weights.test.js`
Expected: 5개 테스트 전부 PASS

- [ ] **Step 5: 라우트 등록**

`api/[...path].js`의 `talentSearchPolicyCommonFitWeights` import 줄(56~58번째 줄 부근) 다음에 추가:

```js
import talentSearchPolicyJobFitWeights from '../handlers/talent-search-policy/job-fit-weights.js';
```

`ROUTES` 배열의 `talent-search-policy/common-fit-weights` 항목(99~101번째 줄 부근) 다음에 추가:

```js
  { pattern: ['talent-search-policy', 'job-fit-weights'], handler: talentSearchPolicyJobFitWeights },
```

- [ ] **Step 6: 수동 확인**

Run: ADMIN 테스트 계정 쿠키로 (항목 3개, 합계 60):
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/job-fit-weights -H "Content-Type: application/json" -d '{"jobFitDefaultWeights":[{"key":"coreExperience","label":"핵심 업무 직접 경험","points":40},{"key":"seniorityScope","label":"직급·독립 수행 범위","points":15},{"key":"niceToHave","label":"우대조건","points":5}],"changeReason":"수동 확인 -- 직무60점 항목 축소 테스트"}'
```
Expected: `200`, `jobFitDefaultWeights`에 3개 항목(합계 60) 반영, `versionNo`가 그 전보다 +1
Run: 합계가 60이 아닌 값으로 같은 요청 → `400 {"error":"배점 합계가 60점이어야 해요 (지금 합계: ...)"}` 확인

- [ ] **Step 7: Commit**

```bash
git add "handlers/talent-search-policy/job-fit-weights.js" "handlers/talent-search-policy/job-fit-weights.test.js" "api/[...path].js"
git commit -m "feat: PATCH /api/talent-search-policy/job-fit-weights 엔드포인트 추가"
```

---

### Task 3: `PATCH /api/talent-search-policy/evidence-coefficients`

**Files:**
- Create: `handlers/talent-search-policy/evidence-coefficients.js`
- Test: `handlers/talent-search-policy/evidence-coefficients.test.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 `makePolicyPatchHandler`
- Produces: `PATCH /api/talent-search-policy/evidence-coefficients` `{ evidenceCoefficients: {none,weak,partial,clear}, changeReason }` → `200 { ...policy_out 응답 }`. `export function validateEvidenceCoefficients(ec)`(이미 Task 1에서 구현됨, 여기서는 테스트만 추가).

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// handlers/talent-search-policy/evidence-coefficients.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvidenceCoefficients } from '../_lib/talentSearchPolicyValidate.js';

const VALID = { none: 0.5, weak: 0.65, partial: 0.8, clear: 1.0 };

test('validateEvidenceCoefficients: 올바른 값이면 null', () => {
  assert.equal(validateEvidenceCoefficients(VALID), null);
});

test('validateEvidenceCoefficients: 0보다 크지 않으면 에러', () => {
  assert.ok(validateEvidenceCoefficients({ ...VALID, none: 0 }));
});

test('validateEvidenceCoefficients: 1보다 크면 에러', () => {
  assert.ok(validateEvidenceCoefficients({ ...VALID, clear: 1.1 }));
});

test('validateEvidenceCoefficients: 순서가 깨지면(약함이 부분보다 큼) 에러', () => {
  assert.ok(validateEvidenceCoefficients({ ...VALID, weak: 0.9 }));
});

test('validateEvidenceCoefficients: 필드가 누락되면 에러', () => {
  assert.ok(validateEvidenceCoefficients({ none: 0.5, weak: 0.65, partial: 0.8 }));
});
```

- [ ] **Step 2: 테스트 실행해서 통과 확인 (검증 로직은 Task 1에서 이미 구현됨)**

Run: `node --test handlers/talent-search-policy/evidence-coefficients.test.js`
Expected: 5개 테스트 전부 PASS

- [ ] **Step 3: 핸들러 작성**

```js
// handlers/talent-search-policy/evidence-coefficients.js
/**
 * PATCH { evidenceCoefficients: {none,weak,partial,clear}, changeReason: string }
 * -> 200 { ...policy_out 응답 }
 *
 * 1B-3: 근거수준별 점수 수정. 저장 형식은 0~1 소수(예: 0.65) -- 화면에서는
 * %로 입력받아 저장 직전에 소수로 변환한다. none<=weak<=partial<=clear
 * 순서를 서버에서 강제한다("약한 근거"가 "명확한 근거"보다 점수가 높아지는
 * 모순을 막기 위함).
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateEvidenceCoefficients } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateEvidenceCoefficients(body.evidenceCoefficients),
  buildOverrides: (body) => ({ evidence_coefficients: body.evidenceCoefficients })
});
```

- [ ] **Step 4: 라우트 등록**

`api/[...path].js`의 `talentSearchPolicyJobFitWeights` import 줄 다음에 추가:

```js
import talentSearchPolicyEvidenceCoefficients from '../handlers/talent-search-policy/evidence-coefficients.js';
```

`ROUTES` 배열의 `talent-search-policy/job-fit-weights` 항목 다음에 추가:

```js
  { pattern: ['talent-search-policy', 'evidence-coefficients'], handler: talentSearchPolicyEvidenceCoefficients },
```

- [ ] **Step 5: 수동 확인**

Run: ADMIN 테스트 계정 쿠키로:
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/evidence-coefficients -H "Content-Type: application/json" -d '{"evidenceCoefficients":{"none":0.5,"weak":0.6,"partial":0.75,"clear":1.0},"changeReason":"수동 확인 -- 근거수준 점수 조정"}'
```
Expected: `200`, `evidenceCoefficients`에 반영, `versionNo` +1
Run: 순서를 깨뜨린 값(`"weak":0.9,"partial":0.75`)으로 같은 요청 → `400 {"error":"명확 ≥ 부분 ≥ 약함 ≥ 없음 순서를 지켜야 해요"}` 확인

- [ ] **Step 6: Commit**

```bash
git add "handlers/talent-search-policy/evidence-coefficients.js" "handlers/talent-search-policy/evidence-coefficients.test.js" "api/[...path].js"
git commit -m "feat: PATCH /api/talent-search-policy/evidence-coefficients 엔드포인트 추가"
```

---

### Task 4: `PATCH /api/talent-search-policy/thresholds`

**Files:**
- Create: `handlers/talent-search-policy/thresholds.js`
- Test: `handlers/talent-search-policy/thresholds.test.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 `makePolicyPatchHandler`
- Produces: `PATCH /api/talent-search-policy/thresholds` `{ thresholds: {totalScoreMin,jobFitScoreMin,minMeaningfulEvidenceCount}, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax, changeReason }` → `200 { ...policy_out 응답 }`. `export function validateThresholdsAndCaps(body)`(이미 Task 1에서 구현됨).

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// handlers/talent-search-policy/thresholds.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateThresholdsAndCaps } from '../_lib/talentSearchPolicyValidate.js';

const VALID = {
  thresholds: { totalScoreMin: 70, jobFitScoreMin: 42, minMeaningfulEvidenceCount: 2 },
  dailyRecommendCapDefault: 50,
  dailyRecommendCapAbsoluteMax: 50
};

test('validateThresholdsAndCaps: 올바른 값이면 null', () => {
  assert.equal(validateThresholdsAndCaps(VALID), null);
});

test('validateThresholdsAndCaps: totalScoreMin이 100 초과면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, thresholds: { ...VALID.thresholds, totalScoreMin: 101 } }));
});

test('validateThresholdsAndCaps: jobFitScoreMin이 60 초과면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, thresholds: { ...VALID.thresholds, jobFitScoreMin: 61 } }));
});

test('validateThresholdsAndCaps: minMeaningfulEvidenceCount가 0이면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, thresholds: { ...VALID.thresholds, minMeaningfulEvidenceCount: 0 } }));
});

test('validateThresholdsAndCaps: 기본값이 절대상한보다 크면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, dailyRecommendCapDefault: 60, dailyRecommendCapAbsoluteMax: 50 }));
});

test('validateThresholdsAndCaps: 기본값과 절대상한이 같으면 통과', () => {
  assert.equal(validateThresholdsAndCaps({ ...VALID, dailyRecommendCapDefault: 50, dailyRecommendCapAbsoluteMax: 50 }), null);
});
```

- [ ] **Step 2: 테스트 실행해서 통과 확인 (검증 로직은 Task 1에서 이미 구현됨)**

Run: `node --test handlers/talent-search-policy/thresholds.test.js`
Expected: 6개 테스트 전부 PASS

- [ ] **Step 3: 핸들러 작성**

```js
// handlers/talent-search-policy/thresholds.js
/**
 * PATCH { thresholds: {...}, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax,
 *         changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 1B-3: 추천 임계값과 하루 추천상한(기본값+절대상한)을 하나의 엔드포인트로
 * 같이 수정한다 -- 화면에서도 "추천 임계값 · 하루 추천 상한" 한 카드로
 * 같이 표시되고 있어서다. 기본값은 절대상한을 넘을 수 없다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateThresholdsAndCaps } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateThresholdsAndCaps(body),
  buildOverrides: (body) => ({
    thresholds: body.thresholds,
    daily_recommend_cap_default: body.dailyRecommendCapDefault,
    daily_recommend_cap_absolute_max: body.dailyRecommendCapAbsoluteMax
  })
});
```

- [ ] **Step 4: 라우트 등록**

`api/[...path].js`의 `talentSearchPolicyEvidenceCoefficients` import 줄 다음에 추가:

```js
import talentSearchPolicyThresholds from '../handlers/talent-search-policy/thresholds.js';
```

`ROUTES` 배열의 `talent-search-policy/evidence-coefficients` 항목 다음에 추가:

```js
  { pattern: ['talent-search-policy', 'thresholds'], handler: talentSearchPolicyThresholds },
```

- [ ] **Step 5: 수동 확인**

Run: ADMIN 테스트 계정 쿠키로:
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-policy/thresholds -H "Content-Type: application/json" -d '{"thresholds":{"totalScoreMin":75,"jobFitScoreMin":45,"minMeaningfulEvidenceCount":3},"dailyRecommendCapDefault":40,"dailyRecommendCapAbsoluteMax":50,"changeReason":"수동 확인 -- 임계값 상향 테스트"}'
```
Expected: `200`, `thresholds`/`dailyRecommendCapDefault`/`dailyRecommendCapAbsoluteMax` 반영, `versionNo` +1
Run: `dailyRecommendCapDefault`를 `dailyRecommendCapAbsoluteMax`보다 크게 보내면 `400 {"error":"하루 추천상한 기본값은 절대상한을 넘을 수 없어요"}` 확인

- [ ] **Step 6: Commit**

```bash
git add "handlers/talent-search-policy/thresholds.js" "handlers/talent-search-policy/thresholds.test.js" "api/[...path].js"
git commit -m "feat: PATCH /api/talent-search-policy/thresholds 엔드포인트 추가"
```

---

### Task 5: 화면에 나머지 세 "수정" 버튼 + 모달 추가 (공통 40점 모달을 범용화해서 재사용)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 2/3/4의 세 PATCH 엔드포인트
- Produces: 없음(화면 종단). `openEditPointsListModal(config)`(공통40점·직무60점이 공유), `openEditEvidenceModal()`, `openEditThresholdsModal()`가 새로 생김.

- [ ] **Step 1: 상단 안내 문구 갱신 — "나머지는 다음 단계" 문구 제거**

`loadAndRenderTalentSearchPolicy` 함수 안, 현재:

```html
      <div class="section-head"><div><h3>현재 적용 중 · 버전 ${policy.versionNo}</h3><div class="desc">Level 1 기준과 공통 40점은 아래 "수정" 버튼으로 바꿀 수 있어요 — 나머지 항목은 다음 단계에서 열려요</div></div></div>
```

이걸 아래로 교체:

```html
      <div class="section-head"><div><h3>현재 적용 중 · 버전 ${policy.versionNo}</h3><div class="desc">아래 각 카드의 "수정" 버튼으로 값을 바꿀 수 있어요</div></div></div>
```

- [ ] **Step 2: 공통 40점 카드의 "수정" 버튼이 새 범용 함수를 쓰도록 변경**

현재:

```html
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditCommonFitModal()">수정</button>
```

(공통 40점 카드 안의 이 버튼은) 그대로 둔다 — `openEditCommonFitModal()`은 Step 5에서 내부 구현만 범용 함수를 호출하도록 바뀌고 함수 이름/버튼 onclick은 그대로 유지된다.

- [ ] **Step 3: 직무 60점 카드에 "수정" 버튼 추가**

현재:

```html
    <div class="section">
      <div class="section-head"><h3>직무 적합도 60점 기본 배점 (합계 ${jobFitSum}점)</h3></div>
      <div class="grid4">
        ${policy.jobFitDefaultWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
    </div>
```

이걸 아래로 교체:

```html
    <div class="section">
      <div class="section-head"><h3>직무 적합도 60점 기본 배점 (합계 ${jobFitSum}점)</h3></div>
      <div class="grid4">
        ${policy.jobFitDefaultWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditJobFitModal()">수정</button>
    </div>
```

- [ ] **Step 4: 근거수준별 점수 카드에 "수정" 버튼 추가**

현재:

```html
    <div class="section">
      <div class="section-head"><h3>근거수준별 점수</h3></div>
      <div class="grid4">
        <div class="kpi"><div class="label">없음</div><div class="value">${Math.round(ec.none*100)}%</div></div>
        <div class="kpi"><div class="label">약함</div><div class="value">${Math.round(ec.weak*100)}%</div></div>
        <div class="kpi"><div class="label">부분</div><div class="value">${Math.round(ec.partial*100)}%</div></div>
        <div class="kpi"><div class="label">명확</div><div class="value">${Math.round(ec.clear*100)}%</div></div>
      </div>
    </div>
```

이걸 아래로 교체:

```html
    <div class="section">
      <div class="section-head"><h3>근거수준별 점수</h3></div>
      <div class="grid4">
        <div class="kpi"><div class="label">없음</div><div class="value">${Math.round(ec.none*100)}%</div></div>
        <div class="kpi"><div class="label">약함</div><div class="value">${Math.round(ec.weak*100)}%</div></div>
        <div class="kpi"><div class="label">부분</div><div class="value">${Math.round(ec.partial*100)}%</div></div>
        <div class="kpi"><div class="label">명확</div><div class="value">${Math.round(ec.clear*100)}%</div></div>
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditEvidenceModal()">수정</button>
    </div>
```

- [ ] **Step 5: 추천 임계값·하루 추천상한 카드에 "수정" 버튼 추가**

현재:

```html
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      <div class="grid4">
        <div class="kpi"><div class="label">총점 기준</div><div class="value">${policy.thresholds.totalScoreMin}점 이상</div></div>
        <div class="kpi"><div class="label">직무점수 기준</div><div class="value">${policy.thresholds.jobFitScoreMin}점 이상</div></div>
        <div class="kpi"><div class="label">의미있는 근거</div><div class="value">${policy.thresholds.minMeaningfulEvidenceCount}개 이상</div></div>
        <div class="kpi"><div class="label">하루 추천 상한</div><div class="value">${policy.dailyRecommendCapDefault}명</div><div style="font-size:11px;color:var(--sub);margin-top:4px;">절대 상한 ${policy.dailyRecommendCapAbsoluteMax}명</div></div>
      </div>
    </div>
```

이걸 아래로 교체:

```html
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      <div class="grid4">
        <div class="kpi"><div class="label">총점 기준</div><div class="value">${policy.thresholds.totalScoreMin}점 이상</div></div>
        <div class="kpi"><div class="label">직무점수 기준</div><div class="value">${policy.thresholds.jobFitScoreMin}점 이상</div></div>
        <div class="kpi"><div class="label">의미있는 근거</div><div class="value">${policy.thresholds.minMeaningfulEvidenceCount}개 이상</div></div>
        <div class="kpi"><div class="label">하루 추천 상한</div><div class="value">${policy.dailyRecommendCapDefault}명</div><div style="font-size:11px;color:var(--sub);margin-top:4px;">절대 상한 ${policy.dailyRecommendCapAbsoluteMax}명</div></div>
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="openEditThresholdsModal()">수정</button>
    </div>
```

- [ ] **Step 6: 공통 40점 모달을 "항목+합계검증" 범용 모달로 일반화, 직무 60점도 이걸 재사용**

기존 `openEditCommonFitModal`/`renderCommonFitRows`/`renderCommonFitSum`/`addCommonFitRow`/`removeCommonFitRow`/`saveCommonFitWeights` 6개 함수와 `let commonFitDraft = [];` 전역 변수 선언 전체를 아래로 교체:

```js
let pointsListDraft = [];
let pointsListConfig = null;
function openEditPointsListModal(config){
  pointsListConfig = config;
  pointsListDraft = config.items.map(w=>({key:w.key, label:w.label, points:w.points}));
  showModal(`
    <h3>${escapeHtml(config.title)}</h3>
    <div id="pointslist-rows"></div>
    <button class="btn ghost sm" onclick="addPointsListRow()">+ 항목 추가</button>
    <div style="margin:10px 0;font-size:13px;">합계: <b id="pointslist-sum"></b>/${config.expectedSum}</div>
    <div class="field"><label>변경 사유</label><input id="f-pointslist-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="pointslist-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="savePointsList()">저장</button></div>
  `, true);
  renderPointsListRows();
}
function renderPointsListRows(){
  const el = document.getElementById('pointslist-rows');
  if(!el) return;
  el.innerHTML = pointsListDraft.map((w,i)=>`
    <div class="field" style="display:flex;flex-direction:row;gap:8px;align-items:center;">
      <input type="text" value="${escapeHtml(w.label)}" placeholder="항목 이름" style="flex:2;" onchange="pointsListDraft[${i}].label=this.value">
      <input type="number" value="${w.points}" placeholder="배점" style="flex:1;" onchange="pointsListDraft[${i}].points=Number(this.value); renderPointsListSum();">
      <button class="btn ghost sm" onclick="removePointsListRow(${i})">삭제</button>
    </div>
  `).join('');
  renderPointsListSum();
}
function renderPointsListSum(){
  const sumEl = document.getElementById('pointslist-sum');
  if(!sumEl) return;
  const sum = pointsListDraft.reduce((s,w)=>s+(Number(w.points)||0),0);
  sumEl.textContent = sum;
  sumEl.style.color = sum===pointsListConfig.expectedSum ? 'var(--primary-dark)' : 'var(--red)';
}
function addPointsListRow(){
  pointsListDraft.push({key: 'item_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), label:'', points:0});
  renderPointsListRows();
}
function removePointsListRow(i){ pointsListDraft.splice(i,1); renderPointsListRows(); }
async function savePointsList(){
  const changeReason = document.getElementById('f-pointslist-reason').value.trim();
  try{ await apiPatch(pointsListConfig.apiPath, {[pointsListConfig.bodyKey]: pointsListDraft, changeReason}); }
  catch(err){
    const box = document.getElementById('pointslist-edit-error');
    box.textContent = err.message; box.style.display = 'block';
    return;
  }
  closeModal();
  await loadAndRenderTalentSearchPolicy();
}
function openEditCommonFitModal(){
  openEditPointsListModal({
    items: tsPolicy.commonFitWeights, bodyKey: 'commonFitWeights',
    apiPath: '/talent-search-policy/common-fit-weights', expectedSum: 40,
    title: '공통 적합도 40점 수정'
  });
}
function openEditJobFitModal(){
  openEditPointsListModal({
    items: tsPolicy.jobFitDefaultWeights, bodyKey: 'jobFitDefaultWeights',
    apiPath: '/talent-search-policy/job-fit-weights', expectedSum: 60,
    title: '직무 적합도 60점 수정'
  });
}
```

(`let tsPolicy = null;` 전역 변수는 그대로 둔다 — `commonFitDraft`만 `pointsListDraft`로 대체된다.)

- [ ] **Step 7: 근거수준별 점수 모달 추가**

바로 위 Step 6에서 넣은 코드 블록 다음에 추가:

```js
function openEditEvidenceModal(){
  const ec = tsPolicy.evidenceCoefficients;
  showModal(`
    <h3>근거수준별 점수 수정</h3>
    <div class="field"><label>명확 (%)</label><input id="f-ec-clear" type="number" min="0" max="100" value="${Math.round(ec.clear*100)}"></div>
    <div class="field"><label>부분 (%)</label><input id="f-ec-partial" type="number" min="0" max="100" value="${Math.round(ec.partial*100)}"></div>
    <div class="field"><label>약함 (%)</label><input id="f-ec-weak" type="number" min="0" max="100" value="${Math.round(ec.weak*100)}"></div>
    <div class="field"><label>없음 (%)</label><input id="f-ec-none" type="number" min="0" max="100" value="${Math.round(ec.none*100)}"></div>
    <div class="field"><label>변경 사유</label><input id="f-ec-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="ec-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveEvidenceCoefficients()">저장</button></div>
  `);
}
async function saveEvidenceCoefficients(){
  const evidenceCoefficients = {
    none: Number(document.getElementById('f-ec-none').value)/100,
    weak: Number(document.getElementById('f-ec-weak').value)/100,
    partial: Number(document.getElementById('f-ec-partial').value)/100,
    clear: Number(document.getElementById('f-ec-clear').value)/100
  };
  const changeReason = document.getElementById('f-ec-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/evidence-coefficients', {evidenceCoefficients, changeReason}); }
  catch(err){
    const box = document.getElementById('ec-edit-error');
    box.textContent = err.message; box.style.display = 'block';
    return;
  }
  closeModal();
  await loadAndRenderTalentSearchPolicy();
}
```

- [ ] **Step 8: 추천 임계값·하루 추천상한 모달 추가**

Step 7에서 넣은 코드 블록 다음에 추가:

```js
function openEditThresholdsModal(){
  const t = tsPolicy.thresholds;
  showModal(`
    <h3>추천 임계값 · 하루 추천상한 수정</h3>
    <div class="field"><label>총점 기준 (점, 100점 만점)</label><input id="f-th-total" type="number" min="0" max="100" value="${t.totalScoreMin}"></div>
    <div class="field"><label>직무점수 기준 (점, 60점 만점)</label><input id="f-th-jobfit" type="number" min="0" max="60" value="${t.jobFitScoreMin}"></div>
    <div class="field"><label>의미있는 근거 개수 (개)</label><input id="f-th-evidence" type="number" min="1" value="${t.minMeaningfulEvidenceCount}"></div>
    <div class="field"><label>하루 추천상한 — 기본값 (명)</label><input id="f-th-capdefault" type="number" min="1" value="${tsPolicy.dailyRecommendCapDefault}"></div>
    <div class="field"><label>하루 추천상한 — 절대상한 (명)</label><input id="f-th-capmax" type="number" min="1" value="${tsPolicy.dailyRecommendCapAbsoluteMax}"></div>
    <div class="field"><label>변경 사유</label><input id="f-th-reason" placeholder="왜 바꾸는지 적어주세요"></div>
    <div id="th-edit-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">취소</button><button class="btn primary" onclick="saveThresholds()">저장</button></div>
  `);
}
async function saveThresholds(){
  const thresholds = {
    totalScoreMin: Number(document.getElementById('f-th-total').value),
    jobFitScoreMin: Number(document.getElementById('f-th-jobfit').value),
    minMeaningfulEvidenceCount: Number(document.getElementById('f-th-evidence').value)
  };
  const dailyRecommendCapDefault = Number(document.getElementById('f-th-capdefault').value);
  const dailyRecommendCapAbsoluteMax = Number(document.getElementById('f-th-capmax').value);
  const changeReason = document.getElementById('f-th-reason').value.trim();
  try{ await apiPatch('/talent-search-policy/thresholds', {thresholds, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax, changeReason}); }
  catch(err){
    const box = document.getElementById('th-edit-error');
    box.textContent = err.message; box.style.display = 'block';
    return;
  }
  closeModal();
  await loadAndRenderTalentSearchPolicy();
}
```

- [ ] **Step 9: 수동 확인 — 5개 카드 전부**

Run: `node scripts/dev-server.js`(포트 3000 재사용 시 재시작), 브라우저에서 ADMIN 테스트 계정으로 로그인 → 인재검색 → 기준 관리센터
Expected:
1. 상단 안내 문구가 "아래 각 카드의 "수정" 버튼으로 값을 바꿀 수 있어요"로 바뀜 (더 이상 "나머지는 다음 단계" 언급 없음)
2. 공통 40점 카드 "수정" → 기존과 동일하게 항목 추가/삭제, 합계 40 검증 동작(리팩터 회귀 확인)
3. 직무 60점 카드 "수정" → 같은 모달 UI로 항목 추가/삭제, 합계가 60이 아니면 저장 막힘, 저장 성공 시 버전 올라가고 값 반영
4. 근거수준별 점수 카드 "수정" → %로 입력, 순서를 깨뜨리면(예: 약함을 명확보다 높게) 에러 메시지, 올바른 값으로 저장 성공
5. 추천 임계값·하루상한 카드 "수정" → 5개 값 한 모달에서 수정, 기본값을 절대상한보다 높게 입력하면 에러, 올바른 값으로 저장 성공
6. 5개 카드 전부 수정 후 페이지를 새로고침해도 값이 유지됨(서버에 저장됨 확인)

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat: 기준 관리센터에 직무60점/근거수준/임계값·하루상한 수정 모달 추가(공통40점 모달 범용화)"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 "포함" 항목(직무60점 API+모달, 근거수준 API+모달(순서검증 포함), 임계값·하루상한 API+모달(하나로 묶음), 공용 팩토리, 검증로직 DB비의존 분리)이 전부 Task 1~5에 매핑됨. "포함 안 함"(버전이력·복구·가상후보, 검색프로젝트별 직무기준)은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음 — 모든 Step에 실제 코드/명령/기대결과가 포함됨.
- **타입/이름 일관성**: API 필드(`jobFitDefaultWeights`/`evidenceCoefficients`/`thresholds`/`dailyRecommendCapDefault`/`dailyRecommendCapAbsoluteMax`, camelCase) ↔ DB 컬럼(`job_fit_default_weights`/`evidence_coefficients`/`thresholds`/`daily_recommend_cap_default`/`daily_recommend_cap_absolute_max`, snake_case)이 Task 1의 `policy_out`/`createPolicyVersion`(기존, 변경 없음)과 Task 2~4의 `buildOverrides`에서 동일하게 유지됨. `validateJobFitDefaultWeights`/`validateEvidenceCoefficients`/`validateThresholdsAndCaps` 함수명이 Task 1의 export 선언과 Task 2/3/4의 테스트 import·핸들러 import에서 일치. `openEditPointsListModal`/`pointsListDraft`/`pointsListConfig`가 Task 5 Step 6~8 안에서 일관되게 참조됨(구 `commonFitDraft` 참조가 남아있지 않음 — Step 6이 관련 함수 6개를 전부 교체).
- **회귀 방지 확인**: Task 1에서 기존 Level1/공통40점 핸들러를 리팩터하지만 API 요청/응답 모양과 검증 규칙은 그대로이므로, Task 1 Step 6(기존 단위테스트 재실행)과 Step 7(수동 curl 확인)로 회귀 여부를 확인한다.

## 실행 순서 안내

Task 1(검증로직 분리+공용 팩토리+기존 2개 리팩터) → Task 2(직무60점 API, Task 1 필요) → Task 3(근거수준 API, Task 1 필요) → Task 4(임계값·하루상한 API, Task 1 필요) → Task 5(화면, Task 2+3+4의 API 필요). Task 2/3/4는 서로 독립적이라 순서를 바꿔도 무방하나 계획상 순서를 고정한다.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 남은 세 모달(직무60점/근거수준/임계값·하루상한)로 실제 값을 수정하는 화면 캡처(수정 전/후, 버전 번호가 올라가는 것)
2. 공통 40점 모달이 리팩터 후에도 그대로 동작하는지(회귀 없음)
3. 각 Task의 수동 확인 절차 통과 결과, 단위테스트 통과 결과(11개 기존 + 5+5+6 신규 = 총 27개)
4. 다음 단계(1B-4: 초안·버전이력·복구·가상후보 미리보기) 착수 여부, 그리고 아직 미룬 프로덕션 마이그레이션(`sql/015`, `sql/016`) 반영 시점
