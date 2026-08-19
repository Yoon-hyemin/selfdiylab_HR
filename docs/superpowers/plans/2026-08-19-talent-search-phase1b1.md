# 인재검색 Phase 1B-1 (기준 관리센터 데이터구조 + 읽기전용 화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회사 전체에 적용되는 인재검색 채점 정책(Level1 문턱값, 공통 40점, 직무 60점 기본 배점, 근거계수, 추천 임계값, 하루 추천상한)을 저장하는 테이블을 만들고 원본 명세서 값으로 시드한 뒤, "인재검색" 화면에 새 서브탭("기준 관리센터")을 추가해 지금 적용 중인 값을 읽기 전용으로 보여준다. 이번 단계에서 값 수정은 아직 안 되고(1B-2/1B-3), 이번이 인재검색 기능 최초로 서버 API에 권한 검사가 생기는 지점이다.

**Architecture:** 기존 패턴 그대로 — Neon Postgres 마이그레이션 파일 추가, `handlers/`에 얇은 GET 핸들러 추가, `api/[...path].js`에 라우트 등록, `index.html`에 서브탭 마크업·전환 함수·렌더 함수 추가.

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`, 순수 SQL.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-19-talent-search-phase1b1-policy-schema-design.md` — 정확한 컬럼명·JSONB 구조·시드 값은 전부 이 문서에서 그대로 가져온다.
- 이 화면(과 이번 API)의 접근 권한은 `accounts.system_role==='ADMIN' || accounts.can_use_talent_search`다 — ADMIN 전용이 아니다(사용자가 명시적으로 확인한 결정).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에도 반드시 등록한다.
- 이 프로젝트는 순수 계산 로직만 `node --test`로 단위테스트하고, DB/HTTP/UI 통합 작업은 로컬 dev 서버 브라우저 수동 검증으로 확인하는 컨벤션을 쓴다(`handlers/_lib/kpiCalc.test.js` 참고). 이번 Phase는 전부 DB/HTTP/UI 통합 작업이라 새 단위테스트 파일은 추가하지 않는다.
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치(운영과 분리된 안전한 사본)에서 한다. 프로덕션 브랜치에 이 마이그레이션을 반영하는 건 이 계획의 범위 밖 — 사용자 확인 후 별도로 진행한다.

---

### Task 1: SQL 마이그레이션 — 정책 테이블 생성 + 시드

**Files:**
- Create: `sql/016_talent_search_policy.sql`

**Interfaces:**
- Produces: `talent_search_policy_versions` 테이블, `version_no=1`인 `status='active'` 시드 행 1개 (뒤 Task들이 `SELECT ... WHERE status='active'`로 읽는다)

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- sql/016_talent_search_policy.sql
--
-- 2026-08-19: 인재검색 자동화 Phase 1B-1. 회사 전체에 적용되는 채점 정책
-- (Level1 문턱값, 공통 40점, 직무 60점 기본 배점, 근거계수, 추천 임계값,
-- 하루 추천상한)을 저장한다. talent_search_projects(sql/015, Phase 1A)와
-- 달리 프로젝트별이 아니라 회사 전체 공용 설정이라 project_id가 없다.
--
-- status는 okrs.status와 같은 컨벤션으로 DB CHECK 제약 없이 앱 레벨에서만
-- 관리한다(draft/active/superseded). 이번엔 시드 행 하나만 바로 active로
-- 넣는다 -- 초안/적용 전환 로직은 1B-4에서 추가한다.
CREATE TABLE talent_search_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no integer NOT NULL,
  level1_rules jsonb NOT NULL,
  common_fit_weights jsonb NOT NULL,
  evidence_coefficients jsonb NOT NULL,
  job_fit_default_weights jsonb NOT NULL,
  rounding_rule jsonb NOT NULL,
  thresholds jsonb NOT NULL,
  sort_tiebreak_rules jsonb NOT NULL,
  daily_recommend_cap_default integer NOT NULL DEFAULT 50,
  daily_recommend_cap_absolute_max integer NOT NULL DEFAULT 50,
  data_retention_months integer NOT NULL DEFAULT 12,
  status text NOT NULL DEFAULT 'draft',
  change_reason text,
  created_by uuid REFERENCES accounts(id),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_no)
);

-- 시드: 원본 명세서(인재검색_자동화_마스터프롬프트_원본.md 5~7장) 초기값 그대로.
-- 공통 40점: 12+8+8+7+5=40. 직무 60점: 30+10+8+6+4+2=60.
INSERT INTO talent_search_policy_versions (
  version_no, level1_rules, common_fit_weights, evidence_coefficients,
  job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
  daily_recommend_cap_default, daily_recommend_cap_absolute_max,
  data_retention_months, status, change_reason, applied_at
) VALUES (
  1,
  '{"resumeUpdated":{"passWithinDays":90,"verifyWithinDays":180},
    "shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,
      "exceptions":["인턴","계약만료","프로젝트완료","폐업","구조조정","관계사이동"]},
    "careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}'::jsonb,
  '[{"key":"ownership","label":"목표완결성·오너십","points":12},
    {"key":"resultOriented","label":"성과·수치 중심 사고","points":8},
    {"key":"problemSolving","label":"문제해결·재발방지","points":8},
    {"key":"execution","label":"실행력·운영 정확성","points":7},
    {"key":"collaboration","label":"협업·조율 능력","points":5}]'::jsonb,
  '{"none":0.5,"weak":0.65,"partial":0.8,"clear":1.0}'::jsonb,
  '[{"key":"coreExperience","label":"핵심 업무 직접 경험","points":30},
    {"key":"seniorityScope","label":"직급·독립 수행 범위","points":10},
    {"key":"similarResults","label":"유사 성과·결과","points":8},
    {"key":"toolsPortfolio","label":"도구·자격·포트폴리오","points":6},
    {"key":"industryFit","label":"산업·사업환경 적합성","points":4},
    {"key":"niceToHave","label":"우대조건","points":2}]'::jsonb,
  '{"unit":0.5,"tieBreak":"roundUp"}'::jsonb,
  '{"totalScoreMin":70,"jobFitScoreMin":42,"minMeaningfulEvidenceCount":2}'::jsonb,
  '["totalScoreDesc","jobFitScoreDesc","evidenceCoverageDesc","resumeUpdatedAtDesc","candidateIdAsc"]'::jsonb,
  50, 50, 12, 'active', '초기값 (원본 명세서 기준값 그대로 시드)', now()
);
```

- [ ] **Step 2: 로컬 dev DB(development 브랜치)에 적용**

Run: `node scripts/run-sql.js sql/016_talent_search_policy.sql`
Expected: 에러 없이 종료

- [ ] **Step 3: 적용 확인**

Run:
```
node -e "
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local','utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)\$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}
import('./handlers/_lib/db.js').then(async ({sql}) => {
  const rows = await sql\`SELECT version_no, status, thresholds FROM talent_search_policy_versions\`;
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
});
"
```
Expected: 행 1개, `version_no: 1`, `status: 'active'`, `thresholds: {"totalScoreMin":70,"jobFitScoreMin":42,"minMeaningfulEvidenceCount":2}`

- [ ] **Step 4: Commit**

```bash
git add sql/016_talent_search_policy.sql
git commit -m "feat: 인재검색 Phase 1B-1 -- talent_search_policy_versions 테이블 생성+시드"
```

---

### Task 2: `requireTalentSearchAccess` 권한 헬퍼

**Files:**
- Modify: `handlers/_lib/accountAuth.js`

**Interfaces:**
- Consumes: 기존 `requireAuth(req, res)` (같은 파일)
- Produces: `export async function requireTalentSearchAccess(req, res)` — Task 3이 이 함수를 import해서 쓴다. 반환값은 `requireRole`/`requireAuth`와 동일하게 "통과하면 account 객체, 실패하면 이미 응답을 쓰고 null" 규약.

- [ ] **Step 1: 함수 추가**

`handlers/_lib/accountAuth.js`의 `requireRole` 함수 바로 다음에 추가:

```js
// 인재검색 기능 전용 권한 검사. requireRole(['ADMIN'])과 달리 "ADMIN이거나
// can_use_talent_search 플래그가 켜진 사람" OR 조건이라 requireRole(배열에
// 값이 있는지만 봄)로는 표현이 안 돼서 별도 함수로 뺀다. Phase 1B-1부터
// 인재검색 관련 모든 API는 requireRole 대신 이 함수를 쓴다 -- Phase 1A
// 시점엔 실제 데이터가 없어 프론트엔드 숨김만으로 충분했지만, 이번이
// 실제 데이터를 내려주는 첫 API라 서버 검사가 필요해졌다.
export async function requireTalentSearchAccess(req, res) {
  const account = await requireAuth(req, res);
  if (!account) return null;
  if (account.system_role !== 'ADMIN' && !account.can_use_talent_search) {
    res.status(403).json({ error: '인재검색 권한이 없어요' });
    return null;
  }
  return account;
}
```

- [ ] **Step 2: import 확인**

파일에 이미 `requireAuth`가 같은 파일 안에서 정의돼 있으므로 추가 import는 필요 없다. 파일을 저장하고 문법 오류가 없는지 확인:

Run: `node -e "import('./handlers/_lib/accountAuth.js').then(m => console.log(typeof m.requireTalentSearchAccess))"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add handlers/_lib/accountAuth.js
git commit -m "feat: 인재검색 전용 권한 헬퍼 requireTalentSearchAccess 추가"
```

---

### Task 3: `GET /api/talent-search-policy` 엔드포인트

**Files:**
- Create: `handlers/talent-search-policy/index.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: Task 1의 `talent_search_policy_versions` 테이블, Task 2의 `requireTalentSearchAccess`
- Produces: `GET /api/talent-search-policy` → `200 { versionNo, level1Rules, commonFitWeights, evidenceCoefficients, jobFitDefaultWeights, roundingRule, thresholds, sortTiebreakRules, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax, dataRetentionMonths, status, changeReason, appliedAt, createdAt }` — Task 4가 프론트에서 `apiGet('/talent-search-policy')`로 이 응답을 받는다.

- [ ] **Step 1: 핸들러 작성**

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
 * 이번 단계(1B-1)는 조회만 -- 수정(POST/PATCH)은 1B-2/1B-3에서 추가한다.
 * 회사 전체 공용 설정이라 프로젝트별로 나뉘지 않는다.
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';

function policy_out(row) {
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const [policy] = await sql`
      SELECT * FROM talent_search_policy_versions WHERE status = 'active'
      ORDER BY version_no DESC LIMIT 1`;
    if (!policy) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    return res.status(200).json(policy_out(policy));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준을 불러오지 못했어요' });
  }
}
```

- [ ] **Step 2: 라우트 등록**

`api/[...path].js`에 import 추가 (`accountsIdTalentSearchAccess` import 줄 다음):

```js
import talentSearchPolicyIndex from '../handlers/talent-search-policy/index.js';
```

`ROUTES` 배열에 항목 추가 (`accounts/:id/talent-search-access` 항목 다음):

```js
  { pattern: ['talent-search-policy'], handler: talentSearchPolicyIndex },
```

- [ ] **Step 3: 수동 확인**

Run: `node scripts/dev-server.js` (이미 실행 중이면 재시작 필요 없음), ADMIN 테스트 계정으로 로그인한 쿠키로:
```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-policy
```
Expected: `{"versionNo":1,"level1Rules":{...},"commonFitWeights":[...],...,"status":"active",...}` — Task 1에서 시드한 값 그대로.

Run: 로그인하지 않은 상태(쿠키 없이) 같은 요청 → `401` 응답 확인 (`requireTalentSearchAccess`가 `requireAuth`부터 통과 못 시킴)

- [ ] **Step 4: Commit**

```bash
git add "handlers/talent-search-policy/index.js" "api/[...path].js"
git commit -m "feat: GET /api/talent-search-policy 엔드포인트 추가"
```

---

### Task 4: "인재검색" 화면에 서브탭 추가 + 기준 관리센터(읽기전용)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 3의 `GET /api/talent-search-policy`
- Produces: 없음(화면 종단) — 1B-2/1B-3이 이 서브탭 안에 수정 UI를 계속 추가해나간다.

- [ ] **Step 1: 서브탭 마크업으로 교체**

현재:
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

이걸 아래로 교체:

```html
    <!-- TALENT SEARCH (인재검색, ADMIN 또는 canUseTalentSearch 계정) -->
    <div class="view" id="view-talentsearch">
      <div class="page-head"><div><h1>인재검색</h1><p>여러 채용 플랫폼의 인재풀을 검색하고 평가해서 추천 후보를 정리해요</p></div></div>
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
      </div>
      <div id="talentsearch-dashboard">
        <div class="section">
          <div class="section-head"><div><h3>검색 프로젝트</h3><div class="desc">아직 화면 골격만 만든 단계라, 실제로 검색 프로젝트를 만드는 기능은 다음 단계에서 추가돼요</div></div></div>
          <div id="talentsearch-projects"></div>
        </div>
      </div>
      <div id="talentsearch-policy" style="display:none;">
        <div id="talentsearch-policy-body"></div>
      </div>
    </div>
```

- [ ] **Step 2: 탭 전환 함수 추가**

`function renderTalentSearchDashboard(){` 함수 바로 앞에 추가:

```js
function switchTalentSearchTab(tab){
  ['dashboard','policy'].forEach(t=>{
    document.getElementById('talentsearch-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('tstab-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='policy') loadAndRenderTalentSearchPolicy();
}
```

- [ ] **Step 3: 정책 조회+렌더 함수 추가**

같은 위치(`switchTalentSearchTab` 함수 바로 다음)에 추가:

```js
async function loadAndRenderTalentSearchPolicy(){
  const el = document.getElementById('talentsearch-policy-body');
  if(!el) return;
  el.innerHTML = '불러오는 중...';
  let policy;
  try{ policy = await apiGet('/talent-search-policy'); }
  catch(err){ el.innerHTML = `<div class="section">${escapeHtml(err.message)}</div>`; return; }

  const l1 = policy.level1Rules;
  const commonSum = policy.commonFitWeights.reduce((s,w)=>s+w.points,0);
  const jobFitSum = policy.jobFitDefaultWeights.reduce((s,w)=>s+w.points,0);
  const ec = policy.evidenceCoefficients;

  el.innerHTML = `
    <div class="section">
      <div class="section-head"><div><h3>현재 적용 중 · 버전 ${policy.versionNo}</h3><div class="desc">지금은 조회만 가능해요 — 수정 기능은 다음 단계에서 추가돼요</div></div></div>
    </div>
    <div class="section">
      <div class="section-head"><h3>1차 필터(Level 1) 기준</h3></div>
      <div style="font-size:13px;line-height:1.8;">
        이력서 업데이트: <b>${l1.resumeUpdated.passWithinDays}일 이내</b> 통과, <b>${l1.resumeUpdated.verifyWithinDays}일</b>까지는 확인 필요, 그 이후는 제외<br>
        잦은 이직: 완료 경력 <b>${l1.shortTenure.monthsThreshold}개월 미만</b>이 단기근속, 최근 <b>${l1.shortTenure.lookbackYears}년</b> 내 <b>${l1.shortTenure.countThreshold}회</b> 이상이면 확인 필요 (예외: ${l1.shortTenure.exceptions.map(escapeHtml).join(', ')})<br>
        경력 공백: <b>${l1.careerGap.ignoreUnderMonths}개월 미만</b> 무시, <b>${l1.careerGap.verifyUnderMonths}개월</b>까지 확인 필요, 그 이상은 설명 필요
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h3>공통 적합도 40점 (합계 ${commonSum}점)</h3></div>
      <div class="grid4">
        ${policy.commonFitWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h3>직무 적합도 60점 기본 배점 (합계 ${jobFitSum}점)</h3></div>
      <div class="grid4">
        ${policy.jobFitDefaultWeights.map(w=>`<div class="kpi"><div class="label">${escapeHtml(w.label)}</div><div class="value">${w.points}점</div></div>`).join('')}
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h3>근거수준별 점수</h3></div>
      <div class="grid4">
        <div class="kpi"><div class="label">없음</div><div class="value">${Math.round(ec.none*100)}%</div></div>
        <div class="kpi"><div class="label">약함</div><div class="value">${Math.round(ec.weak*100)}%</div></div>
        <div class="kpi"><div class="label">부분</div><div class="value">${Math.round(ec.partial*100)}%</div></div>
        <div class="kpi"><div class="label">명확</div><div class="value">${Math.round(ec.clear*100)}%</div></div>
      </div>
    </div>
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      <div class="grid4">
        <div class="kpi"><div class="label">총점 기준</div><div class="value">${policy.thresholds.totalScoreMin}점 이상</div></div>
        <div class="kpi"><div class="label">직무점수 기준</div><div class="value">${policy.thresholds.jobFitScoreMin}점 이상</div></div>
        <div class="kpi"><div class="label">의미있는 근거</div><div class="value">${policy.thresholds.minMeaningfulEvidenceCount}개 이상</div></div>
        <div class="kpi"><div class="label">하루 추천 상한</div><div class="value">${policy.dailyRecommendCapDefault}명</div></div>
      </div>
    </div>
  `;
}
```

- [ ] **Step 4: 수동 확인**

Run: `node scripts/dev-server.js`, 브라우저에서 인재검색 권한이 있는 계정으로 로그인 → "인재검색" 메뉴 클릭 → "기준 관리센터" 탭 클릭
Expected: "현재 적용 중 · 버전 1" 표시, 1차 필터/공통40점(합계 40점)/직무60점(합계 60점)/근거수준(50/65/80/100%)/임계값(70점·42점·2개)·하루상한(50명) 카드가 전부 시드값 그대로 보임. "대시보드" 탭을 다시 누르면 기존 예시 카드 2개가 그대로 보임(안 망가짐).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: 인재검색 화면에 기준 관리센터 서브탭(읽기전용) 추가"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙의 "이번(1B-1)에 포함" 4항목(정책 테이블+시드, 서브탭, 읽기전용 표시, `requireTalentSearchAccess`) 전부 Task 1~4에 매핑됨. "이번에 포함 안 함" 항목(수정 UI, 버전관리 UI, 가상후보 미리보기)은 어떤 Task에도 포함되지 않음 — 의도대로.
- **플레이스홀더 스캔**: 없음. 모든 코드 블록은 그대로 붙여넣을 수 있는 완성된 내용.
- **타입/이름 일관성**: DB 컬럼(snake_case) ↔ `policy_out()` camelCase 매핑이 Task 3/4 전체에서 동일. `switchTalentSearchTab`/`loadAndRenderTalentSearchPolicy` 함수명이 Task 4 안에서 일관되게 참조됨. `apiGet`은 기존 `index.html`에 이미 정의된 헬퍼(예: `loadAndRenderAccounts`의 `apiGet('/accounts')` 참고)를 그대로 재사용 — 새로 정의하지 않음.

## 실행 순서 안내

Task 1(스키마) → Task 2(권한 헬퍼) → Task 3(API, Task 1+2 필요) → Task 4(화면, Task 3의 API 필요) 순서 고정.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 "인재검색 → 기준 관리센터" 화면 캡처
2. 각 Task의 수동 확인 절차 통과 결과
3. 다음 단계(1B-2: Level1+공통40점 실제 수정 가능하게) 착수 여부
