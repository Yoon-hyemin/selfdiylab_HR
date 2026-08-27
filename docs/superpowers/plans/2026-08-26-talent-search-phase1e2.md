# 인재검색 Phase 1E-2 (후보 상세보기 + 수동 평가) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검색 진행 화면의 후보 행을 클릭하면 상세 모달(raw 속성 + 채점 세부내역)이 열리고, 거기서 "정보 부족"/"중복"으로 수동 표시하거나 해제할 수 있게 한다.

**Architecture:** 새 컬럼 `manual_status`(nullable, DB에 실제 저장 — 사람의 판단 자체가 원본 데이터이므로 1E-1의 "점수는 저장 안 함" 원칙과 다름) + PATCH 엔드포인트. 화면은 이미 불러온 후보 목록을 모듈 전역 변수에 캐시해두고 모달은 그 캐시에서 찾아 보여준다(재조회 없음).

**Tech Stack:** Vanilla JS(프론트), Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-26-talent-search-phase1e2-design.md`.
- 새 엔드포인트는 `requireTalentSearchAccess`로 보호, `api/[...path].js`에 등록.
- `manualStatus`는 `null`/`'insufficient_info'`/`'duplicate'` 외 값이면 `400`.
- 목록 판정 표시·카운트는 `manualStatus`가 있으면 자동판정보다 우선한다.
- API camelCase, DB snake_case.
- 로컬 검증은 `development` 브랜치에서.

---

### Task 1: 마이그레이션 — `manual_status` 컬럼

**Files:** Create `sql/020_talent_search_candidate_manual_status.sql`

- [ ] **Step 1**

```sql
-- sql/020_talent_search_candidate_manual_status.sql
--
-- 2026-08-26: 인재검색 Phase 1E-2. "정보 부족"/"중복"은 사람이 후보를
-- 열어봐야 판단 가능한 상태라 자동 채점 엔진(1B-4c)이 못 낸다 -- 그래서
-- 다른 점수/판정과 달리 이 값만 예외적으로 DB에 저장한다.
ALTER TABLE talent_search_candidates
  ADD COLUMN IF NOT EXISTS manual_status text;
```

- [ ] **Step 2**: `node scripts/run-sql.js sql/020_talent_search_candidate_manual_status.sql` → `OK: executed ...`
- [ ] **Step 3**: 확인 —
```bash
node -e "import('./handlers/_lib/db.js').then(async ({sql}) => { console.log(await sql\`SELECT column_name FROM information_schema.columns WHERE table_name='talent_search_candidates' AND column_name='manual_status'\`); });"
```
Expected: `[ { column_name: 'manual_status' } ]`
- [ ] **Step 4**: `git add sql/020_talent_search_candidate_manual_status.sql && git commit -m "feat: talent_search_candidates에 manual_status 컬럼 추가(정보부족/중복 수동표시)"`

---

### Task 2: PATCH API — 수동 상태 저장

**Files:**
- Modify: `handlers/talent-search-projects/[id]/candidates.js`(`candidate_out`에 `manualStatus` 추가)
- Create: `handlers/talent-search-projects/[id]/candidates/[candidateId].js`
- Modify: `api/[...path].js`

**Interfaces:** Produces `PATCH /api/talent-search-projects/:id/candidates/:candidateId` `{ manualStatus }` → `200 { id, manualStatus }` | `400` | `404`. Task 3이 호출.

- [ ] **Step 1**: `handlers/talent-search-projects/[id]/candidates.js`의 `candidate_out` 함수를 아래로 교체:

```js
function candidate_out(row) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    resumeAgeDays: row.resume_age_days,
    shortTenureCount: row.short_tenure_count,
    gapMonths: row.gap_months,
    evidencePattern: row.evidence_pattern,
    manualStatus: row.manual_status,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 2**: 새 핸들러 작성

```js
// handlers/talent-search-projects/[id]/candidates/[candidateId].js
/**
 * handlers/talent-search-projects/[id]/candidates/[candidateId].js
 *
 * PATCH { manualStatus: 'insufficient_info' | 'duplicate' | null } -> 200 { id, manualStatus } | 400 | 404
 *
 * Phase 1E-2: 후보 상세 모달에서 "정보 부족"/"중복"으로 수동 표시하거나
 * 해제한다. 사람의 판단 자체가 원본 데이터라서 이 값만 저장한다(점수·
 * 자동판정은 여전히 저장 안 하고 화면에서 계산).
 */
import { sql } from '../../../_lib/db.js';
import { requireTalentSearchAccess } from '../../../_lib/accountAuth.js';

const ALLOWED = ['insufficient_info', 'duplicate'];

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id, candidateId } = req.query;
  const { manualStatus } = req.body || {};
  if (manualStatus !== null && manualStatus !== undefined && !ALLOWED.includes(manualStatus)) {
    return res.status(400).json({ error: '수동 상태 값이 올바르지 않아요' });
  }
  const value = manualStatus || null;

  try {
    const [row] = await sql`
      UPDATE talent_search_candidates SET manual_status = ${value}
      WHERE id = ${candidateId} AND project_id = ${id}
      RETURNING id, manual_status`;
    if (!row) return res.status(404).json({ error: '후보를 찾을 수 없어요' });
    return res.status(200).json({ id: row.id, manualStatus: row.manual_status });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '수동 상태를 저장하지 못했어요' });
  }
}
```

- [ ] **Step 3**: `api/[...path].js`에 등록 — import 추가(`talentSearchProjectsIdCandidates` import 줄 다음):
```js
import talentSearchProjectsIdCandidateId from '../handlers/talent-search-projects/[id]/candidates/[candidateId].js';
```
`ROUTES` 배열에 추가(`talent-search-projects, :id, candidates` 항목 다음):
```js
  { pattern: ['talent-search-projects', ':id', 'candidates', ':candidateId'], handler: talentSearchProjectsIdCandidateId },
```

- [ ] **Step 4**: 수동 확인. 로그인 후 후보 하나의 id를 GET으로 확인, PATCH로 `{"manualStatus":"insufficient_info"}` → `200`, 같은 후보 GET(목록)에서 `manualStatus:"insufficient_info"` 반영 확인. `{"manualStatus":null}`로 되돌리기 → `manualStatus:null` 확인. 잘못된 값(`{"manualStatus":"foo"}`) → `400`. 다른 프로젝트 소속 candidateId로 시도 → `404`.

- [ ] **Step 5**: `git add "handlers/talent-search-projects/[id]/candidates.js" "handlers/talent-search-projects/[id]/candidates/[candidateId].js" "api/[...path].js" && git commit -m "feat: 후보 수동 상태(정보부족/중복) 저장 엔드포인트 추가"`

---

### Task 3: 화면 — 후보 상세 모달 + 수동 상태 반영

**Files:** Modify `index.html`

- [ ] **Step 1**: `renderTalentSearchCandidatesScreen` 함수를 아래로 교체(현재 함수 전체를 대체 — 결과 캐싱, 5개 카운트, 행 클릭, manualStatus 우선 표시 추가):

```js
let tsCandidatesResults = [];

function tsManualStatusLabel(v){
  return v === 'insufficient_info' ? '정보 부족' : v === 'duplicate' ? '중복' : null;
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
  tsCandidatesResults = results;

  const counts = { '추천':0, '확인 필요':0, '제외':0, '정보 부족':0, '중복':0 };
  results.forEach(({c, r}) => {
    const label = tsManualStatusLabel(c.manualStatus) || r.verdict;
    counts[label] = (counts[label]||0) + 1;
  });

  const rowsHtml = results.map(({c, r}) => {
    const manualLabel = tsManualStatusLabel(c.manualStatus);
    const displayLabel = manualLabel || r.verdict;
    const badgeClass = manualLabel ? 'badge grey' : verdictBadgeClass(r.verdict);
    return `
    <tr class="clickable" onclick="openTalentSearchCandidateDetail('${projectId}','${c.id}')">
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.platform)}</td>
      <td>${r.level1Status}</td>
      <td>${r.totalScore}</td>
      <td><span class="${badgeClass}">${escapeHtml(displayLabel)}</span></td>
    </tr>
  `;
  }).join('');

  el.innerHTML = `
    ${backBtn}
    <div class="section">
      <div class="section-head"><div><h3>${escapeHtml(project.title)} — 검색 진행</h3><div class="desc">가상 시뮬레이션이라 다시 생성할 때마다 결과가 달라져요. 행을 클릭하면 상세와 수동 표시(정보 부족/중복)를 볼 수 있어요.</div></div></div>
      <div class="grid4">
        <div class="kpi"><div class="label">총 후보</div><div class="value">${results.length}명</div></div>
        <div class="kpi"><div class="label">추천</div><div class="value">${counts['추천']}명</div></div>
        <div class="kpi"><div class="label">확인 필요</div><div class="value">${counts['확인 필요']}명</div></div>
        <div class="kpi"><div class="label">제외</div><div class="value">${counts['제외']}명</div></div>
      </div>
      <div class="grid4" style="margin-top:10px;">
        <div class="kpi"><div class="label">정보 부족(수동)</div><div class="value">${counts['정보 부족']}명</div></div>
        <div class="kpi"><div class="label">중복(수동)</div><div class="value">${counts['중복']}명</div></div>
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
```

- [ ] **Step 2**: `renderTalentSearchCandidatesScreen` 함수가 끝나는 `}` 바로 다음에 상세 모달 함수 추가:

```js
function openTalentSearchCandidateDetail(projectId, candidateId){
  const found = tsCandidatesResults.find(({c}) => c.id === candidateId);
  if(!found) return;
  const { c, r } = found;
  const currentManual = c.manualStatus || '';
  showModal(`
    <h3>${escapeHtml(c.name)}</h3>
    <div class="modal-sub">${escapeHtml(c.platform)}</div>
    <div class="field"><label>이력서 최신성</label>${c.resumeAgeDays}일 전 업데이트 (Level1: ${r.level1Status})</div>
    <div class="field"><label>단기근속 횟수</label>${c.shortTenureCount}회</div>
    <div class="field"><label>경력 공백</label>${c.gapMonths}개월</div>
    <div class="field"><label>공통 40점</label>${r.commonScore}점</div>
    <div class="field"><label>직무 60점</label>${r.jobFitScore}점</div>
    <div class="field"><label>총점 · 자동판정</label>${r.totalScore}점 (${r.verdict})</div>
    <div class="field"><label>수동 상태</label>
      <select id="f-cand-manual-status">
        <option value="" ${currentManual===''?'selected':''}>자동판정 사용</option>
        <option value="insufficient_info" ${currentManual==='insufficient_info'?'selected':''}>정보 부족으로 표시</option>
        <option value="duplicate" ${currentManual==='duplicate'?'selected':''}>중복으로 표시</option>
      </select>
    </div>
    <div id="cand-detail-error" style="display:none;color:var(--red);font-size:12.5px;margin-bottom:10px;"></div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">닫기</button><button class="btn primary" onclick="saveTalentSearchCandidateManualStatus('${projectId}','${candidateId}')">저장</button></div>
  `);
}
async function saveTalentSearchCandidateManualStatus(projectId, candidateId){
  const raw = document.getElementById('f-cand-manual-status').value;
  const manualStatus = raw === '' ? null : raw;
  try{
    await apiPatch('/talent-search-projects/'+projectId+'/candidates/'+candidateId, { manualStatus });
  }catch(err){
    const box = document.getElementById('cand-detail-error');
    box.textContent = err.message; box.style.display = 'block';
    return;
  }
  closeModal();
  await openTalentSearchCandidates(projectId);
}
```

- [ ] **Step 3**: 수동 확인. 검색 진행 화면에서 후보 행 클릭 → 모달에 raw 속성·세부점수·자동판정이 보임 → "정보 부족으로 표시" 선택 후 저장 → 모달 닫히고 그 행의 판정 배지가 "정보 부족"으로 바뀌고 카운트도 반영됨 → 다시 열어서 "자동판정 사용"으로 되돌리기 → 원래 배지로 복귀 확인.

- [ ] **Step 4**: `git add index.html && git commit -m "feat: 검색 진행 화면에 후보 상세 모달 + 수동 상태(정보부족/중복) 추가"`

---

## Self-Review

스펙 커버리지: 컬럼(Task1), API(Task2), 모달+표시+카운트(Task3) 전부 매핑. 플레이스홀더 없음. `manualStatus` 필드명이 Task2 응답과 Task3 소비 코드에서 일관.

## 실행 순서

Task 1 → Task 2 → Task 3.
