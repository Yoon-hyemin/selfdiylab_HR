# 인재검색 실제 후보 리스트 직무60점 자동채점 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "검색 진행" 화면의 "실제 후보 리스트" 표가 직무 60점만 자동채점해서 보여주고, 기준(`jobFitScoreMin`)을 넘는 사람만 기본 노출, 미달자는 "더보기"로 접어둔다.

**Architecture:** 전부 `index.html` 안에서만 일어나는 클라이언트 변경(새 API·DB 없음). 근거수준은 후보의 태그·경력요약·최근경력 메모가 프로젝트 키워드와 얼마나 겹치는지로 단일값을 추정해서, 기존 `scoreItemGroup`(가상 후보 채점에 이미 쓰는 함수, 무수정 재사용)에 길이 1짜리 패턴 배열로 넘긴다. 선행 조건으로 `openTalentSearchCandidates()`가 가상 후보 유무와 무관하게 항상 정책을 불러오도록 고친다(지금은 가상 후보가 0명이면 정책 자체를 안 불러와서 이 기능이 항상 실패하는 버그가 있음).

**Tech Stack:** Vanilla JS(`index.html`), 브라우저 콘솔로 수동 검증(이 파일 안 로직은 이 프로젝트에서 자동테스트 대상이 아님 — 기존 관례).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-28-talent-search-list-candidate-jobfit-scoring-design.md`.
- 공통 40점은 적용하지 않는다 — 직무 60점만 60점 만점.
- 근거수준 판정 경계값(1/3, 2/3)은 코드 상수. `keywords.exclude`는 이번 범위에 안 씀.
- 판정은 `jobFitScore >= policy.thresholds.jobFitScoreMin`이면 '추천', 아니면 '확인 필요'만 있다('제외' 없음).
- 점수는 저장하지 않는다 — 매 렌더마다 클라이언트에서 계산(이 프로젝트의 "서버는 원본만" 원칙).
- 가상 후보 채점 로직(`simulateCandidate`, `evaluateLevel1` 등)은 이번 계획의 어떤 태스크에서도 수정하지 않는다.
- 커밋 메시지는 한국어.

---

### Task 1: 정책 로딩 조건 버그 수정 + 실제 후보 리스트에 정책 전달

**Files:** Modify `index.html`

**Interfaces:**
- Produces: `loadTalentSearchListCandidates(projectId, project, policy)` — 기존 `loadTalentSearchListCandidates(projectId)`에서 시그니처 확장. `project`는 `GET /talent-search-projects/:id` 응답 객체(`keywords` 필드 포함), `policy`는 정책 버전 객체 또는 `null`. Task 3이 이 시그니처를 그대로 소비한다.

- [ ] **Step 1: `openTalentSearchCandidates()`의 정책 로딩 조건 수정**

`index.html`에서 아래 블록(현재 `if(candidates.length){` 로 시작):

```js
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
```

를 아래로 교체(바깥쪽 `if(candidates.length)` 제거 — 실제 후보 리스트 채점은 가상 후보 유무와 무관하게 정책이 필요하다):

```js
  let policy = null, policyLoadError = '';
  if(project.policyVersionId){
    try{
      const { versions } = await apiGet('/talent-search-policy/versions');
      policy = versions.find(v=>v.id===project.policyVersionId) || null;
      if(!policy) policyLoadError = '승인 당시 버전을 더 이상 찾을 수 없어요';
    }catch(err){ policyLoadError = err.message; }
  }else{
    policyLoadError = '이 프로젝트는 아직 채점 기준이 고정되지 않았어요';
  }
```

- [ ] **Step 2: `loadTalentSearchListCandidates` 호출부 3곳에 `project`/`policy` 전달**

`renderTalentSearchCandidatesScreen` 함수 안의 `loadTalentSearchListCandidates(projectId);` 호출 3곳(가상후보 없음 분기, 정책 없음 분기, 정상 분기 — 전부 동일한 함수 본문 안에 있음)을 전부 아래로 교체:

```js
  loadTalentSearchListCandidates(projectId, project, policy);
```

`loadTalentSearchListCandidates` 함수 자체의 본문은 이번 Task 1에서는 건드리지 않는다 — 새로 넘어오는 `project`/`policy` 인자를 실제로 쓰는 채점 로직은 Task 3에서 완성한다(JS는 함수가 선언한 것보다 많은 인자로 호출해도 에러 없이 초과분을 무시하므로, 지금 이 스텝만 적용해도 에러는 안 난다 — 다만 아직 채점 기능 자체는 동작하지 않는 상태로 Task 3까지는 남아있다).

- [ ] **Step 3: 수동 확인 (가상 후보 없는 프로젝트에서 정책이 이제 불러와지는지)**

1. 로컬 dev 서버 실행 중인지 확인
2. `preview-test@selfdiylab.invalid`로 로그인 → 승인된 프로젝트 중 **가상 후보를 한 번도 생성 안 한 것**을 하나 골라 "검색 진행 보기" 클릭(없으면 아무 승인된 프로젝트나 골라서 아직 "가상 후보 생성하기" 버튼만 있는 상태로 둔 채 확인)
3. 이전에는 "이 프로젝트는 아직 채점 기준이 고정되지 않았어요"가 (실제로는 고정돼 있어도) 잘못 안 보이던 화면이었는데, 이제는 정책이 정상적으로 불러와지는지 브라우저 개발자 콘솔에서 확인: `console.log(policy)` 같은 임시 로그를 넣거나, 페이지의 Network 탭에서 `/talent-search-policy/versions` 요청이 실제로 발생하는지 확인(가상 후보 유무와 무관하게 항상 발생해야 함)
4. 기존 가상 후보 채점 화면(가상 후보가 있는 다른 프로젝트)이 여전히 정상 동작하는지 회귀 확인

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
fix: 가상후보 없는 프로젝트에서도 채점기준을 불러오도록 수정

openTalentSearchCandidates()가 가상 후보 개수(candidates.length)에
따라 정책 로딩 여부를 결정하던 조건을 제거 -- 실제 후보 리스트
채점(다음 태스크)은 가상 후보 유무와 무관하게 정책이 필요하다.
EOF
)"
```

---

### Task 2: `scoreListCandidateJobFit` 순수 함수

**Files:** Modify `index.html`

**Interfaces:**
- Consumes: `scoreItemGroup(items, pattern, evidenceCoefficients, roundingRule)` (기존 함수, `index.html:3164`, 반환 `{total, meaningfulCount}`).
- Produces: `scoreListCandidateJobFit(candidate, projectKeywords, policy)` → `{ evidenceLevel: string, matchedCount: number, totalCount: number, jobFitScore: number, verdict: '추천'|'확인 필요' }`. Task 3이 이 함수를 그대로 호출한다. `candidate`는 `{tags, careerSummary, recentPositions}`를 포함하는 리스트 후보 객체(`GET .../list-candidates` 응답 모양), `projectKeywords`는 `{include, or, exact, exclude, preferred}`(프로젝트의 `keywords` 필드), `policy`는 `{jobFitDefaultWeights, evidenceCoefficients, roundingRule, thresholds}`를 포함하는 정책 객체.

- [ ] **Step 1: `verdictBadgeClass` 함수 바로 뒤에 추가**

`index.html`에서 `function verdictBadgeClass(v){...}` 함수가 끝나는 줄(`}`) 바로 다음에 추가:

```js
// 리스트로 가져온 실제 후보는 이력서 본문 근거가 없어서 공통40점을
// 적용할 수 없다(그 항목들이 이력서에서 확인한 행동증거를 전제로
// 하기 때문). 직무60점만, 그것도 항목별 근거가 아니라 "이 후보의
// 태그·경력요약이 프로젝트 키워드와 얼마나 겹치는가" 단일 신호로
// 근거수준 하나를 정해 전 항목에 동일 적용하는 근사치다. 상세 설계는
// docs/superpowers/specs/2026-08-28-talent-search-list-candidate-jobfit-scoring-design.md.
// 비율 경계값(1/3, 2/3)은 정책 편집 대상이 아니라 코드 상수 --
// CAREER_YEARS_GRACE(talentSearchListFilter.js)와 같은 층위의 구현
// 디테일이다.
function scoreListCandidateJobFit(candidate, projectKeywords, policy){
  const pool = ['include','or','exact','preferred']
    .flatMap(k => (projectKeywords && projectKeywords[k]) || [])
    .map(k => String(k).trim().toLowerCase())
    .filter(Boolean);
  const uniquePool = [...new Set(pool)];

  const textParts = [
    ...(candidate.tags || []),
    candidate.careerSummary || '',
    ...(candidate.recentPositions || []).map(p => p.note || '')
  ];
  const text = textParts.join(' ').toLowerCase();

  const matchedCount = uniquePool.filter(kw => text.includes(kw)).length;
  const totalCount = uniquePool.length;
  const ratio = totalCount === 0 ? 0 : matchedCount / totalCount;

  const evidenceLevel = ratio === 0 ? '없음' : ratio < 1/3 ? '약함' : ratio < 2/3 ? '부분' : '명확';

  const jobFit = scoreItemGroup(policy.jobFitDefaultWeights, [evidenceLevel], policy.evidenceCoefficients, policy.roundingRule);
  const verdict = jobFit.total >= policy.thresholds.jobFitScoreMin ? '추천' : '확인 필요';

  return { evidenceLevel, matchedCount, totalCount, jobFitScore: jobFit.total, verdict };
}
```

- [ ] **Step 2: 브라우저 콘솔로 수동 검증**

로컬 dev 서버에 로그인한 브라우저 개발자 콘솔에서 직접 호출(이 파일의 다른 순수 함수들과 동일하게, 이 프로젝트는 `index.html` 안 로직에 별도 자동테스트 러너를 안 씀 — 콘솔 수동 호출이 기존 관례):

```js
const fakePolicy = {
  jobFitDefaultWeights: [{key:'a',label:'핵심업무',points:30},{key:'b',label:'포트폴리오',points:30}],
  evidenceCoefficients: {none:0.5, weak:0.65, partial:0.8, clear:1.0},
  roundingRule: {unit:0.5, tieBreak:'roundUp'},
  thresholds: {jobFitScoreMin:42}
};
const kw = {include:['영상편집'], or:[], exact:[], exclude:[], preferred:['Premiere']};

// 매칭 2/2 = 100% -> 명확 -> 60점 만점 -> 추천
console.log(scoreListCandidateJobFit({tags:['영상편집','Premiere'], careerSummary:'', recentPositions:[]}, kw, fakePolicy));

// 매칭 0/2 = 0% -> 없음 -> 30점 -> 확인 필요
console.log(scoreListCandidateJobFit({tags:['회계','세무'], careerSummary:'', recentPositions:[]}, kw, fakePolicy));
```

Expected: 첫 번째 호출은 `{evidenceLevel:'명확', matchedCount:2, totalCount:2, jobFitScore:60, verdict:'추천'}`, 두 번째는 `{evidenceLevel:'없음', matchedCount:0, totalCount:2, jobFitScore:30, verdict:'확인 필요'}`.

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "feat: 실제 후보 리스트용 직무60점 채점 순수함수 추가"
```

---

### Task 3: 실제 후보 리스트 표에 점수·판정·정렬·더보기 반영

**Files:** Modify `index.html`

**Interfaces:**
- Consumes: `scoreListCandidateJobFit(candidate, projectKeywords, policy)`(Task 2), `verdictBadgeClass(v)`(기존), `loadTalentSearchListCandidates(projectId, project, policy)` 시그니처(Task 1에서 호출부는 이미 바뀜, 이번 태스크가 함수 본문을 완성한다).

- [ ] **Step 1: 전역 변수에 `tsListScoringContext`/`tsListShowBelowThreshold` 추가**

현재:

```js
let tsListCandidatesCache = [];
let tsListSortMode = 'importedAt'; // 'importedAt' | 'age' | 'tagCount'
let tsListSortDir = 'desc';
```

아래로 교체:

```js
let tsListCandidatesCache = [];
let tsListSortMode = 'importedAt'; // 'importedAt' | 'age' | 'tagCount' | 'jobFitScore'
let tsListSortDir = 'desc';
let tsListScoringContext = null; // { project, policy } | null -- 정책 없으면 채점 안 함
let tsListShowBelowThreshold = false;
```

- [ ] **Step 2: `tsListCandidateRowHtml`을 정밀 채점값(`r`)을 받도록 변경**

현재:

```js
function tsListCandidateRowHtml(c){
  const tags = (c.tags||[]).join(', ');
  const importedLabel = c.importedAt ? new Date(c.importedAt).toLocaleDateString('ko-KR') : '-';
  return `
    <tr>
      <td><a href="${escapeHtml(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.maskedName)}</a></td>
      <td>${escapeHtml(c.gender||'-')}</td>
      <td>${c.age ?? '-'}</td>
      <td>${escapeHtml(c.careerSummary||'-')}</td>
      <td>${escapeHtml(c.education||'-')}</td>
      <td>${escapeHtml(tags||'-')}</td>
      <td>${escapeHtml(c.lastUpdatedLabel||'-')}</td>
      <td>${escapeHtml(importedLabel)}</td>
    </tr>
  `;
}
```

아래로 교체:

```js
function tsListCandidateRowHtml(c, r){
  const tags = (c.tags||[]).join(', ');
  const importedLabel = c.importedAt ? new Date(c.importedAt).toLocaleDateString('ko-KR') : '-';
  const scoreCells = r ? `<td>${r.jobFitScore}</td><td><span class="${verdictBadgeClass(r.verdict)}">${escapeHtml(r.verdict)}</span></td>` : '';
  return `
    <tr>
      <td><a href="${escapeHtml(c.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.maskedName)}</a></td>
      <td>${escapeHtml(c.gender||'-')}</td>
      <td>${c.age ?? '-'}</td>
      <td>${escapeHtml(c.careerSummary||'-')}</td>
      <td>${escapeHtml(c.education||'-')}</td>
      <td>${escapeHtml(tags||'-')}</td>
      <td>${escapeHtml(c.lastUpdatedLabel||'-')}</td>
      <td>${escapeHtml(importedLabel)}</td>
      ${scoreCells}
    </tr>
  `;
}
```

- [ ] **Step 3: 정렬 로직을 `{c,r}` 엔트리 기준으로 변경 + 채점 헬퍼 추가**

현재:

```js
function tsListSortValue(c){
  if(tsListSortMode==='age') return c.age ?? -1;
  if(tsListSortMode==='tagCount') return (c.tags||[]).length;
  return c.importedAt ? new Date(c.importedAt).getTime() : 0;
}

function tsListSortedCandidates(){
  const dir = tsListSortDir==='asc' ? 1 : -1;
  return [...tsListCandidatesCache].sort((a,b) => (tsListSortValue(a) - tsListSortValue(b)) * dir);
}
```

아래로 교체:

```js
function tsListCandidatesWithScores(){
  if(!tsListScoringContext) return tsListCandidatesCache.map(c => ({ c, r: null }));
  return tsListCandidatesCache.map(c => ({
    c,
    r: scoreListCandidateJobFit(c, tsListScoringContext.project.keywords, tsListScoringContext.policy)
  }));
}

function tsListSortValue(entry){
  const c = entry.c, r = entry.r;
  if(tsListSortMode==='age') return c.age ?? -1;
  if(tsListSortMode==='tagCount') return (c.tags||[]).length;
  if(tsListSortMode==='jobFitScore') return r ? r.jobFitScore : -1;
  return c.importedAt ? new Date(c.importedAt).getTime() : 0;
}

function tsListSortedCandidates(){
  const dir = tsListSortDir==='asc' ? 1 : -1;
  const entries = tsListCandidatesWithScores();
  return [...entries].sort((a,b) => (tsListSortValue(a) - tsListSortValue(b)) * dir);
}
```

- [ ] **Step 4: 정렬 dir 토글 함수 뒤에 더보기 토글 함수 추가**

`function toggleTsListSortDir(){...}` 함수 바로 다음에 추가:

```js
function toggleTsListShowBelowThreshold(){
  tsListShowBelowThreshold = !tsListShowBelowThreshold;
  renderTsListCandidatesTable();
}
```

- [ ] **Step 5: `renderTsListCandidatesTable` 전체 교체**

현재:

```js
function renderTsListCandidatesTable(){
  const bodyEl = document.getElementById('talentsearch-list-candidates-body');
  if(!bodyEl) return;
  if(!tsListCandidatesCache.length){
    bodyEl.innerHTML = '<div class="empty">아직 가져온 후보가 없어요. 크롬 확장에서 사람인 검색결과를 가져와보세요.</div>';
    return;
  }
  const sorted = tsListSortedCandidates();
  bodyEl.innerHTML = `
    <div class="field" style="margin:0 0 10px;flex-direction:row;align-items:center;gap:6px;"><label style="margin:0;">정렬</label>
      <select onchange="changeTsListSort(this.value)">
        <option value="importedAt" ${tsListSortMode==='importedAt'?'selected':''}>가져온 날짜</option>
        <option value="age" ${tsListSortMode==='age'?'selected':''}>나이</option>
        <option value="tagCount" ${tsListSortMode==='tagCount'?'selected':''}>태그 수</option>
      </select>
      <button class="btn ghost sm" onclick="toggleTsListSortDir()">${tsListSortDir==='asc' ? '오름차순 ↑' : '내림차순 ↓'}</button>
    </div>
    <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>이름</th><th>성별</th><th>나이</th><th>경력</th><th>학력</th><th>태그</th><th>최종업데이트</th><th>가져온 날짜</th></tr></thead>
      <tbody>${sorted.map(tsListCandidateRowHtml).join('')}</tbody>
    </table>
    </div>
  `;
}
```

아래로 교체:

```js
function renderTsListCandidatesTable(){
  const bodyEl = document.getElementById('talentsearch-list-candidates-body');
  if(!bodyEl) return;
  if(!tsListCandidatesCache.length){
    bodyEl.innerHTML = '<div class="empty">아직 가져온 후보가 없어요. 크롬 확장에서 사람인 검색결과를 가져와보세요.</div>';
    return;
  }

  const sorted = tsListSortedCandidates(); // [{c, r}]
  const hasScoring = !!tsListScoringContext;
  const passing = hasScoring ? sorted.filter(e => e.r.verdict === '추천') : sorted;
  const belowThreshold = hasScoring ? sorted.filter(e => e.r.verdict !== '추천') : [];
  const rowsToShow = hasScoring && !tsListShowBelowThreshold ? passing : sorted;

  const sortOptions = `
    <option value="importedAt" ${tsListSortMode==='importedAt'?'selected':''}>가져온 날짜</option>
    <option value="age" ${tsListSortMode==='age'?'selected':''}>나이</option>
    <option value="tagCount" ${tsListSortMode==='tagCount'?'selected':''}>태그 수</option>
    ${hasScoring ? `<option value="jobFitScore" ${tsListSortMode==='jobFitScore'?'selected':''}>직무 60점</option>` : ''}
  `;
  const scoreHeader = hasScoring ? '<th>직무60점</th><th>판정</th>' : '';
  const scoringNotice = hasScoring
    ? `<div class="desc" style="margin-bottom:8px;">직무 60점은 태그·경력요약이 프로젝트 키워드와 얼마나 겹치는지로 추정한 근사치예요 — 실제 서류전형 판단 근거로 쓰기엔 부족해요.</div>`
    : '';
  const emptyPassingNotice = hasScoring && !tsListShowBelowThreshold && passing.length === 0
    ? `<div class="empty" style="margin-bottom:8px;">기준을 넘는 후보가 아직 없어요.</div>`
    : '';
  const toggleHtml = hasScoring && belowThreshold.length
    ? `<button class="btn ghost sm" style="margin-top:10px;" onclick="toggleTsListShowBelowThreshold()">${tsListShowBelowThreshold ? '접기' : `확인 필요 ${belowThreshold.length}명 더보기`}</button>`
    : '';

  bodyEl.innerHTML = `
    <div class="field" style="margin:0 0 10px;flex-direction:row;align-items:center;gap:6px;"><label style="margin:0;">정렬</label>
      <select onchange="changeTsListSort(this.value)">${sortOptions}</select>
      <button class="btn ghost sm" onclick="toggleTsListSortDir()">${tsListSortDir==='asc' ? '오름차순 ↑' : '내림차순 ↓'}</button>
    </div>
    ${scoringNotice}
    ${emptyPassingNotice}
    <div style="overflow-x:auto;">
    <table>
      <thead><tr><th>이름</th><th>성별</th><th>나이</th><th>경력</th><th>학력</th><th>태그</th><th>최종업데이트</th><th>가져온 날짜</th>${scoreHeader}</tr></thead>
      <tbody>${rowsToShow.map(e => tsListCandidateRowHtml(e.c, e.r)).join('')}</tbody>
    </table>
    </div>
    ${toggleHtml}
  `;
}
```

- [ ] **Step 6: `loadTalentSearchListCandidates` 함수 본문 완성**

현재(Task 1에서 호출부만 바뀌고 본문은 그대로였음):

```js
async function loadTalentSearchListCandidates(projectId){
  const bodyEl = document.getElementById('talentsearch-list-candidates-body');
  if(!bodyEl) return;
  try{
    const { candidates } = await apiGet(`/talent-search-projects/${projectId}/list-candidates`);
    tsListCandidatesCache = candidates;
    renderTsListCandidatesTable();
  }catch(err){
    bodyEl.innerHTML = `<div class="empty">불러오지 못했어요: ${escapeHtml(err.message)}</div>`;
  }
}
```

아래로 교체:

```js
async function loadTalentSearchListCandidates(projectId, project, policy){
  const bodyEl = document.getElementById('talentsearch-list-candidates-body');
  if(!bodyEl) return;
  tsListScoringContext = policy ? { project, policy } : null;
  tsListSortMode = policy ? 'jobFitScore' : 'importedAt';
  tsListShowBelowThreshold = false;
  try{
    const { candidates } = await apiGet(`/talent-search-projects/${projectId}/list-candidates`);
    tsListCandidatesCache = candidates;
    renderTsListCandidatesTable();
  }catch(err){
    bodyEl.innerHTML = `<div class="empty">불러오지 못했어요: ${escapeHtml(err.message)}</div>`;
  }
}
```

- [ ] **Step 7: 로컬 dev 서버로 수동 검증**

1. `preview-test@selfdiylab.invalid`로 로그인, 승인된 프로젝트의 "검색 진행 보기" → "실제 후보 리스트" 섹션 확인
2. 후보가 아직 없으면, 크롬 확장으로 실제 사람인 검색결과를 가져오거나(가능하면), 개발자 콘솔에서 연결코드로 curl 요청을 보내 테스트 후보 몇 명을 넣는다 — 그 프로젝트의 `keywords.include`/`preferred`와 겹치는 태그를 가진 후보 1~2명, 안 겹치는 후보 1~2명을 섞을 것
3. 표에 "직무60점"·"판정" 칼럼이 뜨는지, 기본적으로 "추천" 판정인 사람만 보이는지, "확인 필요 N명 더보기"를 누르면 나머지가 점수순으로 이어서 나오는지, 다시 누르면 접히는지 확인
4. 정렬 드롭다운에 "직무 60점" 옵션이 있고 기본 선택돼 있는지, 다른 정렬(나이/태그수/가져온날짜)로 바꿔도 정상 동작하는지 확인
5. 승인되지 않았거나 정책을 못 불러오는 예외 상황을 재현하기 어려우면(정상 흐름에서는 거의 발생 안 함), 코드 리딩으로 `hasScoring=false` 분기가 기존 8칼럼 표(점수 칼럼 없이)를 그대로 보여주는지 확인하는 것으로 대체 가능
6. 테스트로 넣은 후보 데이터는 확인 후 정리

- [ ] **Step 8: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: 실제 후보 리스트에 직무60점 채점·판정·정렬·더보기 추가

기준(jobFitScoreMin) 통과자만 기본 노출, 미달자는 더보기로 확인.
정책 없으면 기존처럼 점수 없이 원본 정보만 표시.
EOF
)"
```

---

## Self-Review

**스펙 커버리지**: 정책 로딩 조건 버그(Task1), 근거수준 추정+직무60점 채점 순수함수(Task2), 표 반영(칼럼·기본노출·더보기·정렬·정책없을때 폴백)(Task3) — 스펙의 모든 섹션이 매핑됨. 공통40점 제외·`keywords.exclude` 미사용·점수 미저장·수동조정 없음은 스펙에서도 명시적 범위 밖이라 태스크 없음(의도됨).

**플레이스홀더 스캔**: 없음.

**타입/시그니처 일관성**: `scoreListCandidateJobFit(candidate, projectKeywords, policy)` 반환 `{evidenceLevel, matchedCount, totalCount, jobFitScore, verdict}` — Task2 정의, Task3(`tsListCandidatesWithScores`) 소비 동일. `loadTalentSearchListCandidates(projectId, project, policy)` — Task1이 호출부를 바꾸고, Task3이 본문을 완성 — 시그니처 일치. `tsListCandidateRowHtml(c, r)` — Task3 정의·호출 동일.

## 실행 순서

Task 1 → Task 2 → Task 3 (Task 2는 Task 1과 독립적으로 먼저 해도 무방하지만, Task 3이 둘 다 필요하므로 순서대로 진행 권장).
