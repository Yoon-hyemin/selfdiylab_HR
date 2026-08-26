# 인재검색 Phase 1D-1 (프로젝트 목록/상세 조회 + 대시보드 연동 + 검토화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 만든 검색 프로젝트를 목록/상세로 조회할 수 있게 하고, 대시보드의 고정 "예시" 카드를 실제 데이터로 교체하고, 카드 클릭 시 읽기 전용 검토 화면(요약·조건·지금 적용 중인 채점 기준)을 보여준다.

**Architecture:** `handlers/talent-search-projects/index.js`(이미 POST가 있음)에 GET(목록, 가벼운 필드만)을 추가하고, 새 파일 `handlers/talent-search-projects/[id].js`로 GET(상세, 전체 필드)을 만든다. 프론트는 기존 `renderTalentSearchDashboard()`를 실제 API 호출로 바꾸고, 새 함수 `openTalentSearchProjectDetail(id)`가 상세+정책을 동시에 불러와 `#talentsearch-projects` 컨테이너를 검토 화면으로 갈아치운다(1C의 "새 인재검색" 폼이 이미 쓰는 컨테이너 교체 패턴 재사용). 정책 카드는 기준 관리센터가 이미 갖고 있는 `renderLevel1Body`/`renderPointsListBody`/`renderEvidenceBody`/`renderThresholdsBody` 함수를 그대로 재사용한다(새로 안 만듦).

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`.

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-26-talent-search-phase1d1-design.md` — 정확한 필드 목록·화면 구성은 이 문서에서 그대로 가져온다.
- 두 새 GET 핸들러 모두 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 목록(`GET /talent-search-projects`)은 카드에 필요한 가벼운 필드만, 상세(`GET /talent-search-projects/:id`)는 전체 필드를 반환한다 — 목록 쿼리에서 `keywords`/`work_conditions`/`natural_language_brief`/`clarification_notes`를 SELECT하지 않는다.
- 새 엔드포인트(`:id` 라우트)는 `api/[...path].js`의 import + `ROUTES` 배열에도 반드시 등록한다(목록 GET은 기존 `talent-search-projects` 라우트를 그대로 쓰므로 등록 불필요 — 그 핸들러 파일 안에서 메서드로 분기).
- 이번 슬라이스는 읽기 전용이다 — 승인 액션, 상태 전환, 플랫폼별 검색어 생성, 프로젝트 수정/삭제는 만들지 않는다(1D-2 또는 그 이후).
- 정책 카드(1차필터/공통40점/직무60점/근거수준/임계값)는 기존 `renderLevel1Body(l1)`, `renderPointsListBody(items)`, `renderEvidenceBody(ec)`, `renderThresholdsBody(t, capDefault, capMax)` 함수(모두 `index.html`에 이미 있음, 기준 관리센터가 사용 중)를 그대로 호출한다 — 새로 복붙하지 않는다.
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖(이미 sql/015~017은 production에 반영돼 있으므로 이번 슬라이스는 새 마이그레이션이 없다).

---

### Task 1: `GET /api/talent-search-projects` (목록)

**Files:**
- Modify: `handlers/talent-search-projects/index.js`

**Interfaces:**
- Consumes: 기존 `sql`(`../_lib/db.js`), 기존 `requireTalentSearchAccess`(`../_lib/accountAuth.js`)
- Produces: `GET /api/talent-search-projects` → `200 { projects: [{ id, title, roleTitle, seniorityLevel, employmentType, headcount, location, targetRecommendCount, dailyRecommendCap, platforms, status, createdAt }] }`(최신순). Task 3(화면)이 이 응답을 그대로 카드 렌더링에 쓴다.

- [ ] **Step 1: 파일 상단 JSDoc과 핸들러를 GET/POST 분기로 교체**

`handlers/talent-search-projects/index.js`를 아래로 교체(기존 POST 로직은 그대로 유지, GET 추가 + 파일 헤더 갱신):

```js
/**
 * handlers/talent-search-projects/index.js
 *
 * GET  -> 200 { projects: [{ id, title, roleTitle, seniorityLevel,
 *              employmentType, headcount, location, targetRecommendCount,
 *              dailyRecommendCap, platforms, status, createdAt }] } (최신순 전체)
 * POST { title, roleTitle, seniorityLevel?, experienceMinYears?, experienceMaxYears?,
 *        employmentType, headcount, location?, workConditions?, naturalLanguageBrief?,
 *        keywords?: {include,or,exact,exclude,preferred}, targetRecommendCount,
 *        platforms: string[], clarificationNotes?: [{question,answer}] }
 *   -> 201 { id }
 *
 * Phase 1C에서 POST만 만들었고(검색 프로젝트를 실제로 만드는 첫 엔드포인트,
 * status는 항상 'draft'로 시작) 목록 조회는 없었다. Phase 1D-1에서 GET을
 * 추가한다 -- 대시보드 카드 목록용으로 가벼운 필드만 내려준다(keywords/
 * workConditions/naturalLanguageBrief/clarificationNotes 같은 무거운 필드는
 * 상세 조회, handlers/talent-search-projects/[id].js에서만 내려줌).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { validateTalentSearchProjectInput } from '../_lib/talentSearchProjectValidate.js';

function project_summary_out(row) {
  return {
    id: row.id,
    title: row.title,
    roleTitle: row.role_title,
    seniorityLevel: row.seniority_level,
    employmentType: row.employment_type,
    headcount: row.headcount,
    location: row.location,
    targetRecommendCount: row.target_recommend_count,
    dailyRecommendCap: row.daily_recommend_cap,
    platforms: row.platforms,
    status: row.status,
    createdAt: row.created_at
  };
}

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, title, role_title, seniority_level, employment_type, headcount,
               location, target_recommend_count, daily_recommend_cap, platforms,
               status, created_at
        FROM talent_search_projects
        ORDER BY created_at DESC`;
      return res.status(200).json({ projects: rows.map(project_summary_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '검색 프로젝트 목록을 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const validationError = validateTalentSearchProjectInput(body);
    if (validationError) return res.status(400).json({ error: validationError });

    const keywords = {
      include: body.keywords?.include || [],
      or: body.keywords?.or || [],
      exact: body.keywords?.exact || [],
      exclude: body.keywords?.exclude || [],
      preferred: body.keywords?.preferred || []
    };

    try {
      const [row] = await sql`
        INSERT INTO talent_search_projects (
          title, role_title, seniority_level, experience_min_years, experience_max_years,
          employment_type, headcount, location, work_conditions, natural_language_brief,
          keywords, clarification_notes, target_recommend_count, platforms, created_by
        ) VALUES (
          ${body.title.trim()}, ${body.roleTitle.trim()}, ${body.seniorityLevel || null},
          ${body.experienceMinYears ?? null}, ${body.experienceMaxYears ?? null},
          ${body.employmentType.trim()}, ${body.headcount}, ${body.location || null},
          ${JSON.stringify(body.workConditions || {})}::jsonb, ${body.naturalLanguageBrief || null},
          ${JSON.stringify(keywords)}::jsonb, ${JSON.stringify(body.clarificationNotes || [])}::jsonb,
          ${body.targetRecommendCount}, ${JSON.stringify(body.platforms)}::jsonb, ${account.id}
        ) RETURNING id`;
      return res.status(201).json({ id: row.id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '검색 프로젝트를 만들지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

Note: 권한 검사(`requireTalentSearchAccess`)를 메서드 분기보다 앞으로 옮겼다(기존엔 POST 검사 안에만 있었음) — `handlers/talent-search-job-templates/index.js`가 이미 쓰는 "권한검사 → 메서드분기" 순서와 통일한 것뿐, 동작은 그대로다(POST 쪽은 여전히 인증 필요).

- [ ] **Step 2: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), ADMIN 테스트 계정(`preview-test@selfdiylab.invalid`/`Preview1234`)으로 로그인해서 쿠키 저장 후:

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-projects
```
Expected: `200 {"projects":[...]}` — 최신순으로 지금까지 만든 프로젝트들이 나오고, 각 항목에 `keywords`/`workConditions`/`naturalLanguageBrief`/`clarificationNotes` 필드는 없어야 함(가벼운 필드만).

Run: 기존 POST 동작이 안 깨졌는지 재확인:
```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/talent-search-projects -H "Content-Type: application/json" -d '{"title":"1D-1 수동확인용","roleTitle":"테스트직무","employmentType":"정규직","headcount":1,"targetRecommendCount":10,"platforms":["사람인"]}'
```
Expected: `201 {"id":"<uuid>"}` (기존과 동일)

- [ ] **Step 3: Commit**

```bash
git add "handlers/talent-search-projects/index.js"
git commit -m "feat: GET /api/talent-search-projects(목록) 엔드포인트 추가"
```

---

### Task 2: `GET /api/talent-search-projects/:id` (상세)

**Files:**
- Create: `handlers/talent-search-projects/[id].js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: 기존 `sql`, 기존 `requireTalentSearchAccess`
- Produces: `GET /api/talent-search-projects/:id` → `200 { id, title, roleTitle, seniorityLevel, experienceMinYears, experienceMaxYears, employmentType, headcount, location, workConditions, naturalLanguageBrief, keywords, clarificationNotes, targetRecommendCount, dailyRecommendCap, platforms, status, createdAt, updatedAt }` 또는 `404`. Task 3(화면)이 이 응답으로 검토 화면을 그린다.

- [ ] **Step 1: 핸들러 작성**

```js
// handlers/talent-search-projects/[id].js
/**
 * handlers/talent-search-projects/[id].js
 *
 * GET -> 200 { id, title, roleTitle, seniorityLevel, experienceMinYears,
 *              experienceMaxYears, employmentType, headcount, location,
 *              workConditions, naturalLanguageBrief, keywords, clarificationNotes,
 *              targetRecommendCount, dailyRecommendCap, platforms, status,
 *              createdAt, updatedAt } | 404
 *
 * Phase 1D-1: 검색 프로젝트 상세 조회. 목록(GET /api/talent-search-projects,
 * handlers/talent-search-projects/index.js)이 가벼운 필드만 내려주는 것과
 * 달리, 검토 화면에서만 필요한 무거운 필드(keywords/workConditions/
 * naturalLanguageBrief/clarificationNotes)까지 전부 내려준다.
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';

function project_detail_out(row) {
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
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

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

- [ ] **Step 2: 라우트 등록**

`api/[...path].js`에 import 추가 (`talentSearchProjectsIndex` import 줄 다음):

```js
import talentSearchProjectsId from '../handlers/talent-search-projects/[id].js';
```

`ROUTES` 배열에 항목 추가 (`talent-search-projects` 항목 다음):

```js
  { pattern: ['talent-search-projects', ':id'], handler: talentSearchProjectsId },
```

- [ ] **Step 3: 수동 확인**

Run(Task 1에서 만든 프로젝트의 id를 이어서 사용, 위 curl 응답의 `"id"` 값을 그대로 넣는다):
```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-projects/<위에서 만든 id>
```
Expected: `200` — `title`/`roleTitle`/`employmentType` 등은 물론 `keywords`(빈 배열들이 담긴 객체)와 `workConditions`(`{}`)까지 전부 포함.

Run: 존재하지 않는 id로:
```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-projects/00000000-0000-0000-0000-000000000000
```
Expected: `404 {"error":"검색 프로젝트를 찾을 수 없어요"}`

- [ ] **Step 4: Commit**

```bash
git add "handlers/talent-search-projects/[id].js" "api/[...path].js"
git commit -m "feat: GET /api/talent-search-projects/:id(상세) 엔드포인트 추가"
```

---

### Task 3: 화면 — 대시보드 실제 데이터 연동 + 검토 화면

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 1의 `GET /talent-search-projects`, Task 2의 `GET /talent-search-projects/:id`, 기존 `GET /talent-search-policy`, 기존 `renderLevel1Body`/`renderPointsListBody`/`renderEvidenceBody`/`renderThresholdsBody`/`apiGet`/`escapeHtml`/`switchTalentSearchTab`
- Produces: 없음(화면 종단)

- [ ] **Step 1: `renderTalentSearchDashboard()`를 실제 데이터로 교체**

현재(`index.html`):
```js
function renderTalentSearchDashboard(){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  const sample = [
    {title:'이커머스 리빙상품 기획MD', sub:'대리급 · 정규직 · 서울', today:0, todayCap:50, cumulative:0, target:50},
    {title:'콘텐츠팀 영상PD', sub:'경력 3~5년 · 정규직 · 서울', today:0, todayCap:50, cumulative:0, target:30}
  ];
  el.innerHTML = `
    <button class="btn primary sm" style="margin-bottom:14px;" onclick="openNewTalentSearchForm()">+ 새 인재검색</button>
    <div style="margin-bottom:14px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;font-size:12.5px;color:var(--sub);">
      새로 만든 검색 프로젝트는 아직 이 카드 목록에 나오지 않아요(다음 단계에서 연동돼요). 아래 2개는 예시예요.
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

이걸 아래로 교체:

```js
const TS_STATUS_LABEL = { draft: '작성중' };

async function renderTalentSearchDashboard(){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `<button class="btn primary sm" style="margin-bottom:14px;" onclick="openNewTalentSearchForm()">+ 새 인재검색</button><div style="color:var(--sub);font-size:13px;">불러오는 중...</div>`;

  let projects;
  try{
    const res = await apiGet('/talent-search-projects');
    projects = res.projects;
  }catch(err){
    el.innerHTML = `<button class="btn primary sm" style="margin-bottom:14px;" onclick="openNewTalentSearchForm()">+ 새 인재검색</button><div class="section">${escapeHtml(err.message)}</div>`;
    return;
  }

  const listHtml = projects.length ? `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
      ${projects.map(p=>`
        <div class="section" style="margin-bottom:0;cursor:pointer;" onclick="openTalentSearchProjectDetail('${p.id}')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div>
              <div style="font-size:15px;font-weight:800;">${escapeHtml(p.title)}</div>
              <div style="font-size:12px;color:var(--sub);margin-top:2px;">${escapeHtml(p.roleTitle)}${p.seniorityLevel ? ' · '+escapeHtml(p.seniorityLevel) : ''} · ${escapeHtml(p.employmentType)}${p.location ? ' · '+escapeHtml(p.location) : ''}</div>
            </div>
            <span class="badge grey">${escapeHtml(TS_STATUS_LABEL[p.status] || p.status)}</span>
          </div>
          <div style="display:flex;gap:10px;">
            <div class="kpi" style="flex:1;margin-bottom:0;"><div class="label">오늘 추천</div><div class="value">0 / ${p.dailyRecommendCap}</div></div>
            <div class="kpi" style="flex:1;margin-bottom:0;"><div class="label">누적 추천</div><div class="value">0 / ${p.targetRecommendCount}</div></div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : `<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;font-size:12.5px;color:var(--sub);">아직 만든 검색 프로젝트가 없어요 — 위 "+ 새 인재검색"으로 시작해보세요.</div>`;

  el.innerHTML = `<button class="btn primary sm" style="margin-bottom:14px;" onclick="openNewTalentSearchForm()">+ 새 인재검색</button>${listHtml}`;
}
```

- [ ] **Step 2: 검토 화면 함수 추가**

`renderTalentSearchDashboard` 함수가 끝나는 `}` 바로 다음에 추가:

```js
const TS_WORK_CONDITION_LABELS = {
  expectedStartDate: '희망 입사가능 시점',
  salaryRange: '연봉·보상 범위',
  workArrangement: '출근/재택/출장 조건',
  requiredQualifications: '필수 자격·언어·포트폴리오',
  avoidConditions: '반드시 피해야 할 업무환경/경력유형'
};

function tsTagChips(arr){
  if(!arr || !arr.length) return '<span style="color:var(--sub);font-size:12.5px;">없음</span>';
  return arr.map(k=>`<span class="badge grey" style="margin:2px 4px 2px 0;display:inline-block;">${escapeHtml(k)}</span>`).join('');
}

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
  const summarySentence = `${escapeHtml(p.roleTitle)}${p.seniorityLevel ? ' · '+escapeHtml(p.seniorityLevel) : ''}${(p.experienceMinYears||p.experienceMaxYears) ? ' · 경력 '+(p.experienceMinYears??'?')+'~'+(p.experienceMaxYears??'?')+'년' : ''} · ${escapeHtml(p.employmentType)} · ${p.headcount}명`;

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
      ${tsTagChips(p.keywords.include)}
    </div>
    <div class="section">
      <div class="section-head"><h3>핵심 조건 (OR)</h3></div>
      ${tsTagChips(p.keywords.or)}
    </div>
    <div class="section">
      <div class="section-head"><h3>우대 조건</h3></div>
      ${tsTagChips(p.keywords.preferred)}
    </div>
    <div class="section">
      <div class="section-head"><h3>제외 조건</h3></div>
      ${tsTagChips(p.keywords.exclude)}
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

- [ ] **Step 3: `switchTalentSearchTab`이 여전히 대시보드 진입 시 목록을 새로 불러오는지 확인**

`index.html`에서 `switchTalentSearchTab`을 찾아 확인만 한다(수정 불필요 — Phase 1C에서 이미 `if(tab==='dashboard') renderTalentSearchDashboard();`로 바뀌어 있음. `renderTalentSearchDashboard`가 이제 `async` 함수가 됐지만 `switchTalentSearchTab`은 그 결과를 기다리지 않고 호출만 해도 된다 — 화면이 잠깐 "불러오는 중..."을 보여준 뒤 채워지는 것으로 충분하다):

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

이미 이 형태라면 아무것도 바꾸지 않는다.

- [ ] **Step 4: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000 재사용 시 재시작), 브라우저에서 ADMIN 테스트 계정으로 로그인 → 인재검색 → 대시보드

Expected:
1. "예시" 배지 카드가 더 이상 안 보이고, Task 1/2에서 curl로 만든 프로젝트("1D-1 수동확인용" 등)가 실제 카드로 보임
2. 카드 클릭 → 검토 화면으로 전환 → 필수/핵심/우대/제외 조건(비어있으면 "없음"), 지금 적용 중인 채점 기준 5개 카드(기준 관리센터와 같은 값)가 보임
3. "← 목록으로" 클릭 → 카드 목록으로 복귀
4. "+ 새 인재검색"으로 키워드를 채워서 새 프로젝트를 하나 만들고, 그 카드를 클릭해서 방금 입력한 키워드가 필수/핵심/우대/제외 조건에 정확히 반영됐는지 확인
5. 존재하지 않는 프로젝트(예: 삭제된 적 없는 이 앱에서는 재현 어려움 — 생략 가능)나 네트워크 에러 상황은 코드 리딩으로만 확인해도 무방

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: 인재검색 대시보드 실제 데이터 연동 + 검색 프로젝트 검토 화면 추가"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙(`2026-08-26-talent-search-phase1d1-design.md`)의 "포함" 항목 — 목록/상세 GET(Task 1/2), 대시보드 실제 데이터 연동(Task 3 Step 1), 검토 화면(요약/필수·핵심·우대·제외조건/상세조건/추가질문답변/정책 스냅샷, Task 3 Step 2) 전부 매핑됨. "포함 안 함"(승인 버튼, 플랫폼별 검색어, 유사어 확장, 수정/삭제, 1E/1F)은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음.
- **타입/이름 일관성**: `project_summary_out`(Task 1)과 `project_detail_out`(Task 2)이 반환하는 camelCase 필드명이 Task 3의 카드/검토화면 렌더링에서 참조하는 필드명(`p.roleTitle`, `p.dailyRecommendCap`, `p.workConditions`, `p.clarificationNotes` 등)과 전부 일치. `TS_STATUS_LABEL`(Task 3 Step 1에서 선언)이 Step 2에서도 그대로 참조됨 — 같은 스코프(전역)에 한 번만 선언. `renderLevel1Body`/`renderPointsListBody`/`renderEvidenceBody`/`renderThresholdsBody` 호출 시그니처가 기준 관리센터(`loadAndRenderTalentSearchPolicy`)가 쓰는 것과 동일한 인자 순서로 맞춰짐.

## 실행 순서 안내

Task 1(목록 GET) → Task 2(상세 GET, Task 1과 서로 독립적이나 계획상 순서 고정) → Task 3(화면, Task 1+2의 API 필요) 순서로 진행.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 실제 카드 목록 → 카드 클릭 → 검토 화면(조건·채점 기준) 화면 캡처
2. 각 Task의 수동 확인 절차 통과 결과
3. 다음 단계(1D-2: 플랫폼별 검색어 생성 + "이 조건으로 검색" 승인 액션) 착수 여부
