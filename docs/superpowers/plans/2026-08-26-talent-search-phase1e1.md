# 인재검색 Phase 1E-1 (가상 후보 생성 + 검색 진행 목록 화면) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 검색 프로젝트에 대해 서버가 가상 후보(최소 100명)를 생성해서 저장하고, "검색 진행 보기" 화면에서 그 후보들에 이미 있는 1B-4c 채점 엔진을 적용해 추천/확인필요/제외 판정과 함께 목록으로 보여준다.

**Architecture:** 후보의 raw 속성(이력서 최신성, 단기근속 횟수, 경력공백, 근거수준 패턴)만 새 테이블에 저장하고, 점수·판정은 저장하지 않는다 — `index.html`에 이미 있는 `simulateCandidate`(1B-4c)가 화면에서 매번 계산한다. 서버는 무작위 생성 로직만 담당하고(`Math.random` 기반), 채점 로직은 전혀 새로 안 만든다.

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`(`sql.transaction`).

## Global Constraints

- 스펙 문서: `docs/superpowers/specs/2026-08-26-talent-search-phase1e1-design.md` — 정확한 생성 규칙·API 모양·화면 구성은 이 문서에서 그대로 가져온다.
- 새 엔드포인트(`GET`/`POST /talent-search-projects/:id/candidates`)는 `requireTalentSearchAccess`로 보호(ADMIN 전용 아님).
- API 응답 필드는 camelCase, DB 컬럼은 snake_case.
- 새 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에도 반드시 등록한다.
- 가상 후보 생성(POST)은 `status==='approved'`인 프로젝트에만 허용한다. 재호출 시 기존 후보를 전부 지우고 새로 생성한다("다시 생성").
- 점수·판정(Level1 상태, 공통/직무 점수, 총점, 추천 여부)은 DB에 저장하지 않는다 — 화면(클라이언트)이 이미 있는 `evaluateLevel1`/`scoreItemGroup`/`simulateCandidate`(index.html, 1B-4c에서 만듦)로 매번 계산한다. **이 채점 함수들을 새로 만들거나 복붙하지 말고 그대로 재사용한다.**
- 채점 기준은 프로젝트의 `policyVersionId`(1D-2에서 추가된 컬럼)로 `GET /talent-search-policy/versions`에서 찾아서 쓴다 — 검토 화면(`openTalentSearchProjectDetail`)이 이미 이 조회 로직을 갖고 있다.
- `sql.transaction([stmt1, stmt2, ...])`는 각 statement의 결과 배열을 담은 배열을 반환한다(1B-2에서 이미 확인된 동작) — `DELETE` 다음에 여러 `INSERT ... RETURNING *`를 한 배열에 담아 한 번에 실행하면, 결과 배열의 인덱스 1부터가 각 INSERT의 반환 행이다.
- 후보 이름은 `가상후보-001` 형식의 중립적인 라벨만 쓴다 — 실제 사람 이름처럼 보이는 값을 생성하지 않는다(이 앱이 실제 구성원 개인정보도 다루는 시스템이라 혼동 방지).
- 로컬 검증은 `.env.local`이 가리키는 Neon `development` 브랜치에서 한다. 프로덕션 브랜치 반영은 이 계획의 범위 밖.

---

### Task 1: 마이그레이션 — `talent_search_candidates` 테이블

**Files:**
- Create: `sql/019_talent_search_candidates.sql`

**Interfaces:**
- Produces: 테이블 `talent_search_candidates(id, project_id, name, platform, resume_age_days, short_tenure_count, gap_months, evidence_pattern, created_at)`. Task 2가 이 테이블에 쓰고 읽는다.

- [ ] **Step 1: 마이그레이션 파일 작성**

```sql
-- sql/019_talent_search_candidates.sql
--
-- 2026-08-26: 인재검색 자동화 Phase 1E-1(가상 후보 생성 + 검색 진행 목록
-- 화면). 승인된 검색 프로젝트마다 서버가 생성한 가상 후보의 raw 속성만
-- 저장한다 -- 점수·판정(Level1 상태, 공통/직무 점수, 총점, 추천 여부)은
-- 컬럼으로 두지 않는다. index.html의 evaluateLevel1/scoreItemGroup/
-- simulateCandidate(1B-4c에서 만든 채점 엔진)가 화면에서 그 프로젝트가
-- 승인 시점에 고정해 둔 채점 기준으로 매번 계산한다 -- 이 프로젝트의
-- "서버는 원본만, 계산은 클라이언트" 원칙 그대로.
--
-- evidence_pattern은 1B-4c의 VIRTUAL_CANDIDATES와 정확히 같은 모양
-- (['명확','부분','약함','명확','없음'] 같은 5개 길이 배열)이라, 채점
-- 시 index.html의 기존 함수를 수정 없이 그대로 쓸 수 있다.
CREATE TABLE IF NOT EXISTS talent_search_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL,
  resume_age_days integer NOT NULL,
  short_tenure_count integer NOT NULL,
  gap_months integer NOT NULL,
  evidence_pattern jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: 로컬 development 브랜치에 적용**

Run: `node scripts/run-sql.js sql/019_talent_search_candidates.sql`
Expected: `OK: executed sql/019_talent_search_candidates.sql`

- [ ] **Step 3: 스키마 확인**

Run:
```bash
node -e "
import('./handlers/_lib/db.js').then(async ({sql}) => {
  const cols = await sql\`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='talent_search_candidates' ORDER BY ordinal_position\`;
  console.log(cols);
});
"
```
Expected: `id`(uuid), `project_id`(uuid), `name`(text), `platform`(text), `resume_age_days`(integer), `short_tenure_count`(integer), `gap_months`(integer), `evidence_pattern`(jsonb), `created_at`(timestamp with time zone) — 이 순서로 8개 컬럼

- [ ] **Step 4: Commit**

```bash
git add sql/019_talent_search_candidates.sql
git commit -m "feat: talent_search_candidates 테이블 추가(가상 후보 raw 속성 저장용)"
```

---

### Task 2: 가상 후보 생성/조회 API — `GET`/`POST /api/talent-search-projects/:id/candidates`

**Files:**
- Create: `handlers/talent-search-projects/[id]/candidates.js`
- Modify: `api/[...path].js`

**Interfaces:**
- Consumes: 기존 `sql`(`../../_lib/db.js`), 기존 `requireTalentSearchAccess`(`../../_lib/accountAuth.js`)
- Produces: `GET /api/talent-search-projects/:id/candidates` → `200 { candidates: [{ id, name, platform, resumeAgeDays, shortTenureCount, gapMonths, evidencePattern, createdAt }] }`(생성순, 빈 배열 가능) | `404`. `POST /api/talent-search-projects/:id/candidates` `{}` → `201 { candidates: [...] }`(같은 모양) | `404` | `400`(승인 안 된 프로젝트). Task 3(화면)이 둘 다 호출한다.

- [ ] **Step 1: 핸들러 작성**

```js
// handlers/talent-search-projects/[id]/candidates.js
/**
 * handlers/talent-search-projects/[id]/candidates.js
 *
 * GET  -> 200 { candidates: [{ id, name, platform, resumeAgeDays,
 *              shortTenureCount, gapMonths, evidencePattern, createdAt }] }
 *              (생성순) | 404
 * POST {} -> 201 { candidates: [...] } (같은 모양) | 404 | 400
 *
 * Phase 1E-1: 가상 후보 생성 + 조회. 원본 명세가 실제 플랫폼에서 이력서를
 * 가져오는 걸로 그리지만, Phase 1은 실제 접근 없이 무작위 특성을 가진
 * 가상 후보를 서버가 만들어 저장하는 시뮬레이션이다. 점수/판정은 저장하지
 * 않는다 -- index.html의 evaluateLevel1/scoreItemGroup/simulateCandidate
 * (1B-4c에서 만든 채점 엔진)가 화면에서 매번 계산한다. POST는 재호출
 * 시(="다시 생성") 기존 후보를 지우고 새로 만든다 -- 하나의 트랜잭션
 * 안에서 DELETE 다음 여러 INSERT를 실행해 원자적으로 처리한다.
 */
import { sql } from '../../_lib/db.js';
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';

const EVIDENCE_LEVELS_WEIGHTED = ['없음', '약함', '약함', '부분', '부분', '명확'];

function candidate_out(row) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    resumeAgeDays: row.resume_age_days,
    shortTenureCount: row.short_tenure_count,
    gapMonths: row.gap_months,
    evidencePattern: row.evidence_pattern,
    createdAt: row.created_at
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomEvidencePattern() {
  const pattern = [];
  for (let i = 0; i < 5; i++) {
    pattern.push(EVIDENCE_LEVELS_WEIGHTED[randomInt(0, EVIDENCE_LEVELS_WEIGHTED.length - 1)]);
  }
  return pattern;
}

function generateVirtualCandidates(count, platforms) {
  const candidates = [];
  for (let i = 1; i <= count; i++) {
    candidates.push({
      name: `가상후보-${String(i).padStart(3, '0')}`,
      platform: platforms[randomInt(0, platforms.length - 1)],
      resumeAgeDays: randomInt(0, 250),
      shortTenureCount: randomInt(0, 4),
      gapMonths: randomInt(0, 20),
      evidencePattern: randomEvidencePattern()
    });
  }
  return candidates;
}

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  if (req.method === 'GET') {
    try {
      const [project] = await sql`SELECT id FROM talent_search_projects WHERE id = ${id}`;
      if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });

      const rows = await sql`SELECT * FROM talent_search_candidates WHERE project_id = ${id} ORDER BY created_at`;
      return res.status(200).json({ candidates: rows.map(candidate_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '가상 후보 목록을 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    try {
      const [project] = await sql`SELECT * FROM talent_search_projects WHERE id = ${id}`;
      if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
      if (project.status !== 'approved') {
        return res.status(400).json({ error: '승인된 프로젝트만 가상 후보를 생성할 수 있어요' });
      }

      const count = Math.min(300, Math.max(100, project.target_recommend_count * 3));
      const candidates = generateVirtualCandidates(count, project.platforms);

      const statements = [
        sql`DELETE FROM talent_search_candidates WHERE project_id = ${id}`,
        ...candidates.map(c => sql`
          INSERT INTO talent_search_candidates (
            project_id, name, platform, resume_age_days, short_tenure_count, gap_months, evidence_pattern
          ) VALUES (
            ${id}, ${c.name}, ${c.platform}, ${c.resumeAgeDays}, ${c.shortTenureCount}, ${c.gapMonths}, ${JSON.stringify(c.evidencePattern)}::jsonb
          ) RETURNING *`)
      ];
      const result = await sql.transaction(statements);
      const inserted = result.slice(1).map(r => r[0]);

      return res.status(201).json({ candidates: inserted.map(candidate_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '가상 후보를 생성하지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
```

- [ ] **Step 2: 라우트 등록**

`api/[...path].js`에 import 추가 (`talentSearchProjectsIdApprove` import 줄 다음):

```js
import talentSearchProjectsIdCandidates from '../handlers/talent-search-projects/[id]/candidates.js';
```

`ROUTES` 배열에 항목 추가 (`talent-search-projects, :id, approve` 항목 다음):

```js
  { pattern: ['talent-search-projects', ':id', 'candidates'], handler: talentSearchProjectsIdCandidates },
```

- [ ] **Step 3: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000에 이미 떠 있으면 재시작), ADMIN 테스트 계정(`preview-test@selfdiylab.invalid`/`Preview1234`)으로 로그인해서 쿠키 저장 후, 승인된(`status='approved'`) 프로젝트 하나의 id를 확인(없으면 "+ 새 인재검색"으로 만들고 승인까지 진행):

```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-projects
```

그 id로 후보 생성:
```bash
curl -s -b cookies.txt -X POST http://localhost:3000/api/talent-search-projects/<id>/candidates -H "Content-Type: application/json" -d '{}'
```
Expected: `201 { candidates: [...] }` — 최소 100개, 각 항목에 `name`이 `가상후보-001` 형식, `resumeAgeDays`/`shortTenureCount`/`gapMonths`/`evidencePattern`(길이 5 배열) 전부 채워짐

Run: 목록 재조회로 방금 만든 것과 같은 개수/내용이 나오는지 확인:
```bash
curl -s -b cookies.txt http://localhost:3000/api/talent-search-projects/<id>/candidates
```
Expected: `200 { candidates: [...] }` — 개수가 방금 생성한 것과 동일

Run: 같은 id로 다시 POST(재생성) → 이전과 다른 무작위 값이 나오는지, 개수는 여전히 100 이상인지 확인. 그 후 GET으로 다시 조회했을 때 새로 생성된 값과 일치하는지(옛 데이터가 안 남아있는지) 확인.

Run: `status='draft'`인 프로젝트(승인 전)의 id로 POST 시도 → `400 {"error":"승인된 프로젝트만 가상 후보를 생성할 수 있어요"}` 확인

- [ ] **Step 4: Commit**

```bash
git add "handlers/talent-search-projects/[id]/candidates.js" "api/[...path].js"
git commit -m "feat: 가상 후보 생성(POST)/조회(GET) 엔드포인트 추가"
```

---

### Task 3: 화면 — "검색 진행 보기" 버튼 + 후보 목록 화면

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 2의 `GET`/`POST /talent-search-projects/:id/candidates`, 기존 `GET /talent-search-projects/:id`, 기존 `GET /talent-search-policy/versions`, 기존 `evaluateLevel1`/`scoreItemGroup`/`simulateCandidate`/`verdictBadgeClass`(1B-4c, index.html에 이미 있음, 수정하지 않고 그대로 호출), 기존 `apiGet`/`apiPost`/`escapeHtml`
- Produces: 없음(화면 종단)

- [ ] **Step 1: `openTalentSearchProjectDetail`에 "검색 진행 보기" 버튼 추가**

현재(`index.html`):
```js
    <div class="section">
      ${policyHeaderHtml}
    </div>
    ${policyBodyHtml}
  `;
}
```

이걸 아래로 교체:
```js
    <div class="section">
      ${policyHeaderHtml}
    </div>
    ${policyBodyHtml}
    ${p.status === 'approved' ? `
    <div class="section">
      <div class="section-head"><h3>검색 진행</h3></div>
      <button class="btn primary sm" onclick="openTalentSearchCandidates('${p.id}')">검색 진행 보기</button>
    </div>` : ''}
  `;
}
```

- [ ] **Step 2: 후보 목록 화면 함수 추가**

`openTalentSearchProjectDetail` 함수가 끝나는 `}` 바로 다음(즉 위 Step 1에서 교체한 블록 바로 다음)에 추가:

```js
async function openTalentSearchCandidates(projectId){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="openTalentSearchProjectDetail('${projectId}')">← 뒤로</button><div style="color:var(--sub);font-size:13px;">불러오는 중...</div>`;

  let project, candidatesRes;
  try{
    [project, candidatesRes] = await Promise.all([
      apiGet('/talent-search-projects/'+projectId),
      apiGet('/talent-search-projects/'+projectId+'/candidates')
    ]);
  }catch(err){
    el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button><div class="section">${escapeHtml(err.message)}</div>`;
    return;
  }

  const candidates = candidatesRes.candidates;

  let policy = null, policyLoadError = '';
  if(candidates.length){
    if(project.policyVersionId){
      try{
        const { versions } = await apiGet('/talent-search-policy/versions');
        policy = versions.find(v=>v.id===project.policyVersionId) || null;
        if(!policy) policyLoadError = '승인 당시 버전을 더 이상 찾을 수 없어요';
      }catch(err){ policyLoadError = err.message; }
    }else{
      policyLoadError = '이 프로젝트는 아직 채점 기준이 고정되지 않았어요';
    }
  }

  renderTalentSearchCandidatesScreen(projectId, project, candidates, policy, policyLoadError);
}

function renderTalentSearchCandidatesScreen(projectId, project, candidates, policy, policyLoadError){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;

  const backBtn = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="openTalentSearchProjectDetail('${projectId}')">← 뒤로</button>`;

  if(!candidates.length){
    el.innerHTML = `
      ${backBtn}
      <div class="section">
        <div class="section-head"><div><h3>${escapeHtml(project.title)} — 검색 진행</h3><div class="desc">아직 가상 후보를 생성하지 않았어요</div></div></div>
        <div style="font-size:12.5px;color:var(--sub);margin-bottom:10px;">가상 시뮬레이션이라 다시 생성할 때마다 결과가 달라져요.</div>
        <button class="btn primary sm" onclick="generateTalentSearchCandidates('${projectId}')">가상 후보 생성하기</button>
      </div>
    `;
    return;
  }

  if(!policy){
    el.innerHTML = `${backBtn}<div class="section">${escapeHtml(policyLoadError || '채점 기준을 불러오지 못했어요')}</div>`;
    return;
  }

  const results = candidates.map(c => ({ c, r: simulateCandidate(c, policy) }));
  results.sort((a,b) => b.r.totalScore - a.r.totalScore);

  const counts = { '추천':0, '확인 필요':0, '제외':0 };
  results.forEach(({r}) => { counts[r.verdict] = (counts[r.verdict]||0) + 1; });

  const rowsHtml = results.map(({c, r}) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.platform)}</td>
      <td>${r.level1Status}</td>
      <td>${r.totalScore}</td>
      <td><span class="${verdictBadgeClass(r.verdict)}">${r.verdict}</span></td>
    </tr>
  `).join('');

  el.innerHTML = `
    ${backBtn}
    <div class="section">
      <div class="section-head"><div><h3>${escapeHtml(project.title)} — 검색 진행</h3><div class="desc">가상 시뮬레이션이라 다시 생성할 때마다 결과가 달라져요</div></div></div>
      <div class="grid4">
        <div class="kpi"><div class="label">총 후보</div><div class="value">${results.length}명</div></div>
        <div class="kpi"><div class="label">추천</div><div class="value">${counts['추천']}명</div></div>
        <div class="kpi"><div class="label">확인 필요</div><div class="value">${counts['확인 필요']}명</div></div>
        <div class="kpi"><div class="label">제외</div><div class="value">${counts['제외']}명</div></div>
      </div>
      <button class="btn ghost sm" style="margin-top:10px;" onclick="regenerateTalentSearchCandidatesConfirm('${projectId}')">다시 생성</button>
    </div>
    <div class="section">
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>가상후보</th><th>플랫폼</th><th>Level1</th><th>총점</th><th>판정</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      </div>
    </div>
  `;
}

async function generateTalentSearchCandidates(projectId){
  const el = document.getElementById('talentsearch-projects');
  if(el) el.innerHTML = `<div style="color:var(--sub);font-size:13px;">가상 후보를 생성하는 중...</div>`;
  try{
    await apiPost('/talent-search-projects/'+projectId+'/candidates', {});
  }catch(err){
    alert(err.message);
  }
  await openTalentSearchCandidates(projectId);
}

function regenerateTalentSearchCandidatesConfirm(projectId){
  if(!confirm('다시 생성하면 지금 목록은 사라지고 새 가상 후보로 바뀌어요. 계속할까요?')) return;
  generateTalentSearchCandidates(projectId);
}
```

- [ ] **Step 3: 수동 확인**

Run: `node scripts/dev-server.js`(포트 3000 재사용 시 재시작), 브라우저에서 ADMIN 테스트 계정으로 로그인 → 인재검색 → 대시보드

Expected:
1. 승인된(`승인됨` 배지) 프로젝트 카드를 클릭 → 검토 화면 맨 아래에 "검색 진행" 섹션과 "검색 진행 보기" 버튼이 보임(draft 상태 프로젝트에는 이 섹션 자체가 안 보이는지도 확인)
2. "검색 진행 보기" 클릭 → 아직 후보가 없으므로 "가상 후보 생성하기" 버튼만 있는 빈 상태 화면이 보임
3. "가상 후보 생성하기" 클릭 → 잠시 후 총 후보 수(최소 100명)/추천/확인필요/제외 카운트 카드와 후보 목록 표(가상후보-001 형식 이름, 플랫폼, Level1, 총점, 판정 배지)가 총점 내림차순으로 보임
4. "다시 생성" 클릭 → 확인창 → 확인 → 목록이 다른 무작위 값으로 바뀌는지 확인(정확히 같을 필요는 없고, 완전히 새로 생성됐다는 것만 확인 — 예: 총점 상위 후보의 이름/점수가 이전과 달라짐)
5. "← 뒤로" 클릭 → 그 프로젝트의 검토 화면으로 돌아가는지 확인
6. 대시보드로 돌아갔다가 같은 프로젝트를 다시 열어서 "검색 진행 보기" → 방금 생성한 후보 목록이 그대로 유지되는지(새로고침해도 안 사라지는지) 확인

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 승인된 프로젝트에 검색 진행 화면 추가(가상 후보 생성/목록, 1B-4c 채점 엔진 재사용)"
```

---

## Self-Review 결과

- **스펙 커버리지**: 스펙(`2026-08-26-talent-search-phase1e1-design.md`)의 "포함" 항목 — 테이블(Task 1), 생성/조회 API + 재생성 로직 + 승인 전 프로젝트 차단(Task 2), "검색 진행 보기" 버튼 + 빈 상태/목록 화면 + 요약 카운트 + 다시 생성(Task 3) 전부 매핑됨. "포함 안 함"(상세보기, 수동 평가, 일시정지/재개, 배치 시뮬레이션, 대시보드 카드 연동)은 어떤 Task에도 없음 — 의도대로.
- **플레이스홀더 스캔**: 없음.
- **타입/이름 일관성**: `candidate_out`(Task 2)이 반환하는 camelCase 필드(`resumeAgeDays`/`shortTenureCount`/`gapMonths`/`evidencePattern`)가 Task 3의 `simulateCandidate(c, policy)` 호출(1B-4c 함수, `candidate.resumeAgeDays`/`candidate.shortTenureCount`/`candidate.gapMonths`/`candidate.evidencePattern`을 읽음)과 정확히 일치 — 새 필드명을 만들지 않고 기존 채점 함수가 기대하는 이름을 그대로 맞춘 것. `openTalentSearchCandidates`/`renderTalentSearchCandidatesScreen`/`generateTalentSearchCandidates`/`regenerateTalentSearchCandidatesConfirm` 함수명이 정의(Task 3 Step 2)와 서로의 호출부(Step 1의 버튼, 화면 안의 버튼들)에서 일관됨.

## 실행 순서 안내

Task 1(마이그레이션) → Task 2(생성/조회 API, Task 1 필요) → Task 3(화면, Task 2의 API + 기존 1B-4c 채점 함수 필요) 순서로 진행.

모든 Task 완료 후, 사용자(윤혜민)에게 다음을 보여주고 승인받는다:
1. 로컬 dev 서버에서 "검색 진행 보기" → "가상 후보 생성하기" → 목록·카운트 화면 캡처
2. 각 Task의 수동 확인 절차 통과 결과
3. 다음 단계(1E-2: 후보 상세보기/평가) 착수 여부, 그리고 이번에 추가된 `sql/019`의 프로덕션 반영 여부도 다시 확인
