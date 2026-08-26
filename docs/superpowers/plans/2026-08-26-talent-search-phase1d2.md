# 인재검색 Phase 1D-2 (플랫폼별 검색어 생성 + 승인 액션) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검토 화면에 규칙 기반 "플랫폼별 검색어" 섹션을 추가하고, "이 조건으로 검색" 승인 버튼으로 프로젝트 상태를 draft→approved로 바꾸면서 그 시점의 채점 기준 버전을 프로젝트에 영구히 고정한다.

**Architecture:** 검색어 생성은 서버 API 없이 클라이언트에서 이미 가진 `keywords`로 계산한다(새 엔드포인트 없음). 승인은 새 컬럼(`policy_version_id`) + 새 PATCH 엔드포인트(`/talent-search-projects/:id/approve`)로 처리한다. 상세 조회(`[id].js`)와 승인 액션(`[id]/approve.js`)이 같은 모양의 응답을 돌려줘야 해서, 응답 변환 함수(`project_detail_out`)를 `handlers/_lib/talentSearchProject.js`로 옮겨 공유한다(`handlers/accounts/[id].js`와 `handlers/accounts/[id]/*.js`가 `handlers/_lib/accountAdmin.js`의 `account_out`을 공유하는 기존 패턴과 동일).

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-26-talent-search-phase1d2-design.md` — 정확한 검색어 생성 규칙·API 모양·화면 구성은 이 문서에서 그대로 가져온다.
- 새 엔드포인트(`PATCH /talent-search-projects/:id/approve`)는 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에도 반드시 등록한다.
- 승인은 `status==='draft'`일 때만 허용한다(재승인 방지).
- 승인 시 저장하는 `policy_version_id`는 그 시점의 **활성**(`status='active'`) 정책 버전 id다. 이후 정책이 바뀌어도 이 값은 다시 안 바뀐다.
- 플랫폼별 검색어는 지금은 4개 플랫폼 모두 같은 문자열을 보여준다(플랫폼별 실제 문법 차이는 이번 범위 밖) — 화면에 그 사실을 안내하는 문구를 반드시 둔다.
- "이 조건으로 검색" 버튼을 눌러도 실제 플랫폼 검색은 시작되지 않는다(검색 진행은 1E, 아직 없음) — 이 버튼의 동작은 상태 전환뿐이다.
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖.

---

### Task 1: 마이그레이션 — `policy_version_id` 컬럼 추가

**Files:**
- Create: `sql/018_talent_search_project_approval.sql`

**Interfaces:**
- Produces: `talent_search_projects.policy_version_id`(nullable uuid, `talent_search_policy_versions(id)` 참조). Task 2가 이 컬럼에 쓰고 읽는다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- sql/018_talent_search_project_approval.sql
--
-- 2026-08-26: 인재검색 자동화 Phase 1D-2(플랫폼별 검색어 생성 + 승인 액션).
-- "이 조건으로 검색" 버튼을 누르면(승인) 그 시점의 활성 채점 기준 버전
-- id를 이 컬럼에 저장해서 영구히 고정한다 -- 이후 기준 관리센터에서
-- 정책이 새 버전으로 바뀌어도 이미 승인된 프로젝트는 승인 당시 버전을
-- 계속 가리킨다. 승인 전에는 NULL.
ALTER TABLE talent_search_projects
  ADD COLUMN IF NOT EXISTS policy_version_id uuid REFERENCES talent_search_policy_versions(id);
```

- [ ] **Step 2: 로컬 development 브랜치에 적용**

Run: `node scripts/run-sql.js sql/018_talent_search_project_approval.sql`
Expected: `OK: executed sql/018_talent_search_project_approval.sql`

- [ ] **Step 3: 스키마 확인**

Run:
```bash
node -e "
import('./handlers/_lib/db.js').then(async ({sql}) => {
  const cols = await sql\`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='talent_search_projects' AND column_name='policy_version_id'\`;
  console.log(cols);
});
"
```
Expected: `[ { column_name: 'policy_version_id', data_type: 'uuid' } ]`

- [ ] **Step 4: Commit**

```bash
git add sql/018_talent_search_project_approval.sql
git commit -m "feat: talent_search_projects에 policy_version_id 컬럼 추가(승인 시점 기준 스냅샷용)"
```

---

### Task 2: 승인 API — `PATCH /api/talent-search-projects/:id/approve`

**Files:**
- Create: `handlers/_lib/talentSearchProject.js`
- Modify: `handlers/talent-search-projects/[id].js`
- Create: `handlers/talent-search-projects/[id]/approve.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: 기존 `sql`(`../_lib/db.js`), 기존 `requireTalentSearchAccess`(`../_lib/accountAuth.js`), 기존 `getActivePolicy`(`../_lib/talentSearchPolicy.js`)
- Produces: `export function project_detail_out(row)`(`handlers/_lib/talentSearchProject.js`, `policyVersionId` 필드 포함) — Task 2 안에서 `[id].js`와 `[id]/approve.js`가 둘 다 이 함수를 쓴다. `PATCH /api/talent-search-projects/:id/approve` `{}` → `200 { ...project_detail_out 응답, status:'approved', policyVersionId:<uuid> }` | `404` | `400`(이미 draft가 아님) | `409`(활성 기준 없음). Task 3(화면)이 이 엔드포인트를 호출한다.

- [ ] **Step 1: 공유 응답 변환 함수를 `handlers/_lib/talentSearchProject.js`로 분리**

```js
// handlers/_lib/talentSearchProject.js
/**
 * handlers/_lib/talentSearchProject.js
 *
 * 검색 프로젝트(talent_search_projects) 행을 API 응답 모양(camelCase)으로
 * 바꾸는 공용 변환 함수. 상세 조회(handlers/talent-search-projects/[id].js)와
 * 승인 액션(handlers/talent-search-projects/[id]/approve.js)이 같은 모양의
 * 응답을 돌려줘야 해서 여기 한 곳에 모은다 -- handlers/accounts/[id].js와
 * handlers/accounts/[id]/*.js가 handlers/_lib/accountAdmin.js의 account_out을
 * 공유하는 기존 패턴과 동일하다.
 *
 * Phase 1D-2에서 policyVersionId 필드가 추가됐다(승인 전엔 null).
 */
export function project_detail_out(row) {
  return {
    id: row.id,
    title: row.title,
    roleTitle: row.role_title,
    seniorityLevel: row.seniority_level,
    experienceMinYears: row.experience_min_years,
    experienceMaxYears: row.experience_max_years,
    employmentType: row.employment_type,
    headcount: row.headcount,
    location: row.location,
    workConditions: row.work_conditions,
    naturalLanguageBrief: row.natural_language_brief,
    keywords: row.keywords,
    clarificationNotes: row.clarification_notes,
    targetRecommendCount: row.target_recommend_count,
    dailyRecommendCap: row.daily_recommend_cap,
    platforms: row.platforms,
    status: row.status,
    policyVersionId: row.policy_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

- [ ] **Step 2: `[id].js`가 공유 함수를 쓰도록 교체**

`handlers/talent-search-projects/[id].js`를 아래로 교체:

```js
/**
 * handlers/talent-search-projects/[id].js
 *
 * GET -> 200 { id, title, roleTitle, seniorityLevel, experienceMinYears,
 *              experienceMaxYears, employmentType, headcount, location,
 *              workConditions, naturalLanguageBrief, keywords, clarificationNotes,
 *              targetRecommendCount, dailyRecommendCap, platforms, status,
 *              policyVersionId, createdAt, updatedAt } | 404
 *
 * Phase 1D-1: 검색 프로젝트 상세 조회. 목록(GET /api/talent-search-projects,
 * handlers/talent-search-projects/index.js)이 가벼운 필드만 내려주는 것과
 * 달리, 검토 화면에서만 필요한 무거운 필드까지 전부 내려준다.
 *
 * Phase 1D-2: 응답 변환 함수(project_detail_out)를 handlers/_lib/
 * talentSearchProject.js로 옮겼다 -- 승인 액션(handlers/talent-search-projects/
 * [id]/approve.js)이 같은 모양의 응답을 돌려줘야 해서 공유가 필요해졌다.
 * 이때 policyVersionId 필드가 추가됐다(승인 전엔 null).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { project_detail_out } from '../_lib/talentSearchProject.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  try {
    const [row] = await sql`SELECT * FROM talent_search_projects WHERE id = ${id}`;
    if (!row) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
    return res.status(200).json(project_detail_out(row));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '검색 프로젝트를 불러오지 못했어요' });
  }
}
```

- [ ] **Step 3: 승인 핸들러 작성**

```js
// handlers/talent-search-projects/[id]/approve.js
/**
 * handlers/talent-search-projects/[id]/approve.js
 *
 * PATCH {} -> 200 { ...project_detail_out 응답, status:'approved', policyVersionId 채워짐 }
 *
 * Phase 1D-2: "이 조건으로 검색" 승인 액션. status를 draft->approved로
 * 바꾸고, 그 시점의 활성 채점 기준 버전 id를 policy_version_id에 저장해서
 * 영구히 고정한다(이후 기준 관리센터에서 정책이 새 버전으로 바뀌어도 이
 * 값은 안 바뀜). 원본 명세 154행 원칙 그대로 -- 이 버튼을 눌러도 실제
 * 플랫폼 검색은 아직 시작되지 않는다(검색 진행은 1E, 아직 없음). 재승인을
 * 막기 위해 status가 'draft'가 아니면 거부한다.
 */
import { sql } from '../../_lib/db.js';
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { getActivePolicy } from '../../_lib/talentSearchPolicy.js';
import { project_detail_out } from '../../_lib/talentSearchProject.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  try {
    const [project] = await sql`SELECT * FROM talent_search_projects WHERE id = ${id}`;
    if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
    if (project.status !== 'draft') {
      return res.status(400).json({ error: '이미 승인됐거나 승인할 수 없는 상태예요' });
    }

    const activePolicy = await getActivePolicy();
    if (!activePolicy) return res.status(409).json({ error: '적용 중인 채점 기준이 없어요' });

    const [updated] = await sql`
      UPDATE talent_search_projects
      SET status = 'approved', policy_version_id = ${activePolicy.id}, updated_at = now()
      WHERE id = ${id}
      RETURNING *`;
    return res.status(200).json(project_detail_out(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '승인 처리에 실패했어요' });
  }
}
```

- [ ] **Step 4: 라우트 등록**

`api/[...path].js`에 import 추가 (`talentSearchProjectsId` import 줄 다음):

```js
import talentSearchProjectsIdApprove from '../handlers/talent-search-projects/[id]/approve.js';
```

`ROUTES` 배열에 항목 추가 (`talent-search-projects, :id` 항목 다음):

```js
  { pattern: ['talent-search-projects', ':id', 'approve'], handler: talentSearchProjectsIdApprove },
```

- [ ] **Step 5: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), ADMIN 테스트 계정(`preview-test@selfdiylab.invalid`/`Preview1234`)으로 로그인해서 쿠키 저장 후, "+ 새 인재검색"으로 만든 프로젝트 하나의 id를 목록 조회로 확인:

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-projects
```

그 id로 승인 시도:
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-projects/<id>/approve -H "Content-Type: application/json" -d '{}'
```
Expected: `200` — `status:"approved"`, `policyVersionId`에 uuid 값이 채워짐(기존 상세 조회 필드 전부 그대로 유지되는지도 확인)

Run: 같은 id로 다시 승인 시도(이미 approved 상태):
```bash
curl -s -b cookies.txt -X PATCH http://localhost:3000/api/talent-search-projects/<id>/approve -H "Content-Type: application/json" -d '{}'
```
Expected: `400 {"error":"이미 승인됐거나 승인할 수 없는 상태예요"}`

Run: 상세 조회로 `policyVersionId`가 유지되는지 재확인:
```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-projects/<id>
```
Expected: `status:"approved"`, `policyVersionId`가 승인 응답과 같은 값

- [ ] **Step 6: Commit**

```bash
git add "handlers/_lib/talentSearchProject.js" "handlers/talent-search-projects/[id].js" "handlers/talent-search-projects/[id]/approve.js" "api/[...path].js"
git commit -m "feat: PATCH /api/talent-search-projects/:id/approve(승인) 엔드포인트 추가, 상세조회 응답변환 공유 라이브러리로 분리"
```

---

### Task 3: 화면 — 플랫폼별 검색어 섹션 + 승인 버튼/배지

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 2의 `PATCH /talent-search-projects/:id/approve`, 기존 `GET /talent-search-projects/:id`, 기존 `GET /talent-search-policy`, 기존 `GET /talent-search-policy/versions`, 기존 `apiGet`/`apiPatch`/`escapeHtml`/`tsTagChips`/`renderLevel1Body`/`renderPointsListBody`/`renderEvidenceBody`/`renderThresholdsBody`
- Produces: 없음(화면 종단)

- [ ] **Step 1: `TS_STATUS_LABEL`에 `approved` 추가**

현재(`index.html`):
```js
const TS_STATUS_LABEL = { draft: '작성중' };
```

이걸로 교체:
```js
const TS_STATUS_LABEL = { draft: '작성중', approved: '승인됨' };
```

- [ ] **Step 2: `openTalentSearchProjectDetail` 전체 교체**

현재(`index.html`):
```js
async function openTalentSearchProjectDetail(id){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button><div style="color:var(--sub);font-size:13px;">불러오는 중...</div>`;

  let project, policy;
  try{
    [project, policy] = await Promise.all([
      apiGet('/talent-search-projects/'+id),
      apiGet('/talent-search-policy')
    ]);
  }catch(err){
    el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button><div class="section">${escapeHtml(err.message)}</div>`;
    return;
  }

  const p = project;
  const summarySentence = `${escapeHtml(p.roleTitle)}${p.seniorityLevel ? ' · '+escapeHtml(p.seniorityLevel) : ''}${(p.experienceMinYears||p.experienceMaxYears) ? ' · 경력 '+(p.experienceMinYears??'?')+'~'+(p.experienceMaxYears??'?')+'년' : ''} · ${escapeHtml(p.employmentType)} · ${p.headcount}명${p.location ? ' · '+escapeHtml(p.location) : ''}`;

  const workConditionRows = Object.keys(TS_WORK_CONDITION_LABELS)
    .filter(k => p.workConditions && p.workConditions[k])
    .map(k => `<div style="font-size:13px;margin-bottom:6px;"><b>${TS_WORK_CONDITION_LABELS[k]}</b>: ${escapeHtml(p.workConditions[k])}</div>`)
    .join('');

  const clarificationHtml = (p.clarificationNotes && p.clarificationNotes.length) ? p.clarificationNotes.map(n=>`
    <div style="font-size:13px;margin-bottom:8px;">
      <div style="color:var(--sub);">${escapeHtml(n.question)}</div>
      <div>${n.answer ? escapeHtml(n.answer) : '<span style="color:var(--sub);">답하지 않음</span>'}</div>
    </div>
  `).join('') : '<div style="font-size:13px;color:var(--sub);">추가질문이 없었어요</div>';

  const commonSum = policy.commonFitWeights.reduce((s,w)=>s+w.points,0);
  const jobFitSum = policy.jobFitDefaultWeights.reduce((s,w)=>s+w.points,0);

  el.innerHTML = `
    <button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button>
    <div class="section">
      <div class="section-head"><div><h3>${escapeHtml(p.title)}</h3><div class="desc">${summarySentence}</div></div><span class="badge grey">${escapeHtml(TS_STATUS_LABEL[p.status] || p.status)}</span></div>
      ${p.naturalLanguageBrief ? `<div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(p.naturalLanguageBrief)}</div>` : ''}
    </div>
    <div class="section">
      <div class="section-head"><h3>필수 조건</h3></div>
      ${tsTagChips(p.keywords?.include)}
    </div>
    <div class="section">
      <div class="section-head"><h3>핵심 조건 (OR)</h3></div>
      ${tsTagChips(p.keywords?.or)}
    </div>
    <div class="section">
      <div class="section-head"><h3>정확일치 문구</h3></div>
      ${tsTagChips(p.keywords?.exact)}
    </div>
    <div class="section">
      <div class="section-head"><h3>우대 조건</h3></div>
      ${tsTagChips(p.keywords?.preferred)}
    </div>
    <div class="section">
      <div class="section-head"><h3>제외 조건</h3></div>
      ${tsTagChips(p.keywords?.exclude)}
    </div>
    ${workConditionRows ? `<div class="section"><div class="section-head"><h3>상세조건</h3></div>${workConditionRows}</div>` : ''}
    <div class="section">
      <div class="section-head"><h3>추가질문 답변</h3></div>
      ${clarificationHtml}
    </div>
    <div class="section">
      <div class="section-head"><h3>검색할 플랫폼</h3></div>
      ${tsTagChips(p.platforms)}
    </div>
    <div class="section">
      <div class="section-head"><div><h3>지금 적용 중인 채점 기준 · 버전 ${policy.versionNo}</h3><div class="desc">이 프로젝트를 승인하는 시점의 버전으로 고정됩니다 — 승인 기능은 다음 단계에서 추가돼요</div></div></div>
    </div>
    <div class="section">
      <div class="section-head"><h3>1차 필터(Level 1) 기준</h3></div>
      <div style="font-size:13px;line-height:1.8;">${renderLevel1Body(policy.level1Rules)}</div>
    </div>
    <div class="section">
      <div class="section-head"><h3>공통 적합도 40점 (합계 ${commonSum}점)</h3></div>
      ${renderPointsListBody(policy.commonFitWeights)}
    </div>
    <div class="section">
      <div class="section-head"><h3>직무 적합도 60점 기본 배점 (합계 ${jobFitSum}점)</h3></div>
      ${renderPointsListBody(policy.jobFitDefaultWeights)}
    </div>
    <div class="section">
      <div class="section-head"><h3>근거수준별 점수</h3></div>
      ${renderEvidenceBody(policy.evidenceCoefficients)}
    </div>
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      ${renderThresholdsBody(policy.thresholds, policy.dailyRecommendCapDefault, policy.dailyRecommendCapAbsoluteMax)}
    </div>
  `;
}
```

이걸 아래로 교체(fetch 로직이 `status`에 따라 갈라지고, "플랫폼별 검색어" 섹션과 승인 버튼/배지가 추가됨):

```js
function buildTalentSearchQueryString(keywords){
  const parts = [];
  if(keywords?.include?.length) parts.push(keywords.include.join(' '));
  if(keywords?.or?.length) parts.push('('+keywords.or.join('|')+')');
  if(keywords?.exact?.length) parts.push(keywords.exact.map(k=>'"'+k+'"').join(' '));
  if(keywords?.exclude?.length) parts.push(keywords.exclude.map(k=>'-'+k).join(' '));
  return parts.join(' ').trim();
}

async function approveTalentSearchProject(id){
  if(!confirm('이 조건으로 승인할까요? 승인하면 지금 채점 기준이 고정되고, 나중에 되돌릴 수 없어요.')) return;
  try{
    await apiPatch('/talent-search-projects/'+id+'/approve', {});
  }catch(err){
    alert(err.message);
    return;
  }
  await openTalentSearchProjectDetail(id);
}

async function openTalentSearchProjectDetail(id){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button><div style="color:var(--sub);font-size:13px;">불러오는 중...</div>`;

  let project;
  try{
    project = await apiGet('/talent-search-projects/'+id);
  }catch(err){
    el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button><div class="section">${escapeHtml(err.message)}</div>`;
    return;
  }

  let policy = null, policyLoadError = '';
  try{
    if(project.status === 'approved' && project.policyVersionId){
      const { versions } = await apiGet('/talent-search-policy/versions');
      policy = versions.find(v=>v.id===project.policyVersionId) || null;
      if(!policy) policyLoadError = '승인 당시 버전을 더 이상 찾을 수 없어요';
    }else{
      policy = await apiGet('/talent-search-policy');
    }
  }catch(err){
    policyLoadError = err.message;
  }

  const p = project;
  const summarySentence = `${escapeHtml(p.roleTitle)}${p.seniorityLevel ? ' · '+escapeHtml(p.seniorityLevel) : ''}${(p.experienceMinYears||p.experienceMaxYears) ? ' · 경력 '+(p.experienceMinYears??'?')+'~'+(p.experienceMaxYears??'?')+'년' : ''} · ${escapeHtml(p.employmentType)} · ${p.headcount}명${p.location ? ' · '+escapeHtml(p.location) : ''}`;

  const workConditionRows = Object.keys(TS_WORK_CONDITION_LABELS)
    .filter(k => p.workConditions && p.workConditions[k])
    .map(k => `<div style="font-size:13px;margin-bottom:6px;"><b>${TS_WORK_CONDITION_LABELS[k]}</b>: ${escapeHtml(p.workConditions[k])}</div>`)
    .join('');

  const clarificationHtml = (p.clarificationNotes && p.clarificationNotes.length) ? p.clarificationNotes.map(n=>`
    <div style="font-size:13px;margin-bottom:8px;">
      <div style="color:var(--sub);">${escapeHtml(n.question)}</div>
      <div>${n.answer ? escapeHtml(n.answer) : '<span style="color:var(--sub);">답하지 않음</span>'}</div>
    </div>
  `).join('') : '<div style="font-size:13px;color:var(--sub);">추가질문이 없었어요</div>';

  const queryString = buildTalentSearchQueryString(p.keywords);
  const searchTermsHtml = queryString
    ? p.platforms.map(pl=>`<div style="font-size:13px;margin-bottom:6px;"><b>${escapeHtml(pl)}</b>: <code>${escapeHtml(queryString)}</code></div>`).join('')
    : '<div style="font-size:13px;color:var(--sub);">검색어를 만들 수 없어요 — 필수 조건이나 키워드가 있어야 해요</div>';

  const policyBodyHtml = policy ? `
    <div class="section">
      <div class="section-head"><h3>1차 필터(Level 1) 기준</h3></div>
      <div style="font-size:13px;line-height:1.8;">${renderLevel1Body(policy.level1Rules)}</div>
    </div>
    <div class="section">
      <div class="section-head"><h3>공통 적합도 40점 (합계 ${policy.commonFitWeights.reduce((s,w)=>s+w.points,0)}점)</h3></div>
      ${renderPointsListBody(policy.commonFitWeights)}
    </div>
    <div class="section">
      <div class="section-head"><h3>직무 적합도 60점 기본 배점 (합계 ${policy.jobFitDefaultWeights.reduce((s,w)=>s+w.points,0)}점)</h3></div>
      ${renderPointsListBody(policy.jobFitDefaultWeights)}
    </div>
    <div class="section">
      <div class="section-head"><h3>근거수준별 점수</h3></div>
      ${renderEvidenceBody(policy.evidenceCoefficients)}
    </div>
    <div class="section">
      <div class="section-head"><h3>추천 임계값 · 하루 추천 상한</h3></div>
      ${renderThresholdsBody(policy.thresholds, policy.dailyRecommendCapDefault, policy.dailyRecommendCapAbsoluteMax)}
    </div>
  ` : `<div class="section">${escapeHtml(policyLoadError || '채점 기준을 불러오지 못했어요')}</div>`;

  const policyHeaderHtml = p.status === 'approved'
    ? `<div class="section-head"><div><h3>승인 당시 채점 기준${policy ? ' · 버전 '+policy.versionNo : ''}(고정됨)</h3><div class="desc">이 값은 승인 시점에 고정돼서 이후 기준이 바뀌어도 안 바뀌어요</div></div><span class="badge grey">✅ 승인됨</span></div>`
    : `<div class="section-head"><div><h3>지금 적용 중인 채점 기준${policy ? ' · 버전 '+policy.versionNo : ''}</h3><div class="desc">승인하면 이 시점의 버전으로 고정돼요</div></div></div>
       <button class="btn primary sm" style="margin-top:10px;" onclick="approveTalentSearchProject('${p.id}')">이 조건으로 검색</button>`;

  el.innerHTML = `
    <button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button>
    <div class="section">
      <div class="section-head"><div><h3>${escapeHtml(p.title)}</h3><div class="desc">${summarySentence}</div></div><span class="badge grey">${escapeHtml(TS_STATUS_LABEL[p.status] || p.status)}</span></div>
      ${p.naturalLanguageBrief ? `<div style="font-size:13px;white-space:pre-wrap;">${escapeHtml(p.naturalLanguageBrief)}</div>` : ''}
    </div>
    <div class="section">
      <div class="section-head"><h3>필수 조건</h3></div>
      ${tsTagChips(p.keywords?.include)}
    </div>
    <div class="section">
      <div class="section-head"><h3>핵심 조건 (OR)</h3></div>
      ${tsTagChips(p.keywords?.or)}
    </div>
    <div class="section">
      <div class="section-head"><h3>정확일치 문구</h3></div>
      ${tsTagChips(p.keywords?.exact)}
    </div>
    <div class="section">
      <div class="section-head"><h3>우대 조건</h3></div>
      ${tsTagChips(p.keywords?.preferred)}
    </div>
    <div class="section">
      <div class="section-head"><h3>제외 조건</h3></div>
      ${tsTagChips(p.keywords?.exclude)}
    </div>
    ${workConditionRows ? `<div class="section"><div class="section-head"><h3>상세조건</h3></div>${workConditionRows}</div>` : ''}
    <div class="section">
      <div class="section-head"><h3>추가질문 답변</h3></div>
      ${clarificationHtml}
    </div>
    <div class="section">
      <div class="section-head"><h3>검색할 플랫폼</h3></div>
      ${tsTagChips(p.platforms)}
    </div>
    <div class="section">
      <div class="section-head"><h3>플랫폼별 검색어</h3></div>
      <div style="font-size:12px;color:var(--sub);margin-bottom:8px;">지금은 플랫폼마다 검색 문법 차이 없이 같은 규칙으로 만들어져요 — 실제 플랫폼 연동에서 플랫폼별 문법에 맞게 다듬을 예정이에요</div>
      ${searchTermsHtml}
    </div>
    <div class="section">
      ${policyHeaderHtml}
    </div>
    ${policyBodyHtml}
  `;
}
```

- [ ] **Step 3: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000 재사용 시 재시작), 브라우저에서 ADMIN 테스트 계정으로 로그인 → 인재검색 → 대시보드

Expected:
1. 키워드가 채워진 draft 프로젝트 카드를 클릭 → 검토 화면에 "플랫폼별 검색어" 섹션이 보이고, 선택한 각 플랫폼 아래 같은 검색식 문자열이 보임(예: 필수키워드 공백구분 + `(OR1|OR2)` + `"정확일치"` + `-제외1`)
2. 같은 화면에서 "지금 적용 중인 채점 기준" 아래 "이 조건으로 검색" 버튼이 보임 → 클릭 → 확인창(confirm) → 확인 → 화면이 다시 그려지며 상태 배지가 "승인됨"으로 바뀌고, 채점 기준 섹션 제목이 "승인 당시 채점 기준(고정됨)"으로 바뀌고 버튼 대신 "✅ 승인됨" 배지가 보임
3. 대시보드로 돌아가서 방금 승인한 카드의 상태 배지도 "승인됨"으로 보이는지 확인
4. 그 프로젝트를 다시 클릭해서 승인 후에도 채점 기준 값이 그대로 보이는지 확인(승인 시점에 고정된 값)
5. 키워드를 하나도 안 넣은 프로젝트(있다면)를 열어서 "검색어를 만들 수 없어요" 안내가 뜨는지 확인 — 없으면 "+ 새 인재검색"으로 키워드 없이 하나 만들어서 확인
6. curl로 이미 승인된 프로젝트에 다시 승인 시도 → 400 에러가 화면에서도(콘솔 등으로) 재현되는지, 혹은 버튼 자체가 이제 안 보이므로(승인됨 배지로 대체) UI로는 재현 안 되는 게 정상이라는 것만 확인

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 검토 화면에 플랫폼별 검색어 섹션 + 승인 버튼 추가, 승인된 프로젝트는 고정된 기준 버전 표시"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙(`2026-08-26-talent-search-phase1d2-design.md`)의 "포함" 항목 — 컬럼 추가(Task 1), 승인 API + 재승인 방지 + 응답 변환 공유(Task 2), 플랫폼별 검색어 섹션 + 승인 버튼/배지 + 승인된 프로젝트의 고정 버전 조회(Task 3) 전부 매핑됨. "포함 안 함"(실제 검색 실행, 수정/삭제, 반려, 플랫폼별 실제 문법 차이)은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음.
- **타입/이름 일관성**: `project_detail_out`이 Task 2에서 `handlers/_lib/talentSearchProject.js`로 옮겨진 뒤 `[id].js`와 `[id]/approve.js` 양쪽에서 동일한 import 경로(`'../_lib/talentSearchProject.js'`/`'../../_lib/talentSearchProject.js'`, 디렉터리 깊이에 맞게)로 참조됨. `policyVersionId`(camelCase, API)↔`policy_version_id`(snake_case, DB)가 Task 1(마이그레이션)부터 Task 2(핸들러)·Task 3(화면)까지 동일하게 유지됨. `buildTalentSearchQueryString`/`approveTalentSearchProject` 함수명이 정의(Task 3 Step 2 상단)와 `openTalentSearchProjectDetail` 안의 호출부에서 일관됨.

## 실행 순서 안내

Task 1(마이그레이션) → Task 2(승인 API, Task 1 필요) → Task 3(화면, Task 2의 API 필요) 순서로 진행.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 검토 화면의 "플랫폼별 검색어" 섹션과 "이 조건으로 검색" 승인 버튼 클릭 → 승인됨 상태로 바뀌는 화면 캡처
2. 각 Task의 수동 확인 절차 통과 결과
3. 다음 단계(1E: 검색 진행 시뮬레이션) 착수 여부, 그리고 이번에 추가된 `sql/018`의 프로덕션 반영 여부도 다시 확인
