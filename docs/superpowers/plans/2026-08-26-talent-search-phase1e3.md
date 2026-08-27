# 인재검색 Phase 1E-3 (대시보드 누적 추천 숫자 연동) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 대시보드 카드의 "누적 추천" 숫자를 하드코딩된 0에서 실제 생성된 가상 후보의 추천 판정 수로 바꾼다.

**Architecture:** 순수 프론트엔드 변경(새 API 없음). 승인된 프로젝트마다 기존 `GET /talent-search-projects/:id/candidates`와 `GET /talent-search-policy/versions`를 불러와 이미 있는 1B-4c 채점 엔진(`simulateCandidate`)으로 클라이언트에서 계산한다. "오늘 추천"은 하루 단위 배치 개념이 아직 없어서(1E-1/1E-2가 "한 번에 생성" 모델이라 "그날"이 없음) 이번에도 그대로 0으로 둔다 — 실제 배치 스케줄링이 생기기 전까지는 만들 수 없는 값이라 억지로 값을 지어내지 않는다.

**Tech Stack:** Vanilla JS(프론트).

## Global Constraints

- 새 API/스키마 변경 없음. 기존 3개 엔드포인트(`GET /talent-search-projects`, `GET /talent-search-projects/:id/candidates`, `GET /talent-search-policy/versions`)만 재사용.
- 수동상태(`manualStatus`)가 있는 후보는 추천 카운트에서 제외한다(1E-2의 "수동상태가 자동판정보다 우선" 원칙과 일관).
- `draft` 상태 프로젝트나 후보가 없는 프로젝트는 그대로 0을 보여준다(에러 아님).
- 한 프로젝트의 후보 조회가 실패해도 다른 프로젝트 카드 렌더링을 막지 않는다(그 카드만 0으로 표시).

---

### Task 1: 대시보드 누적 추천 계산 + 반영

**Files:** Modify `index.html`

- [ ] **Step 1**: `renderTalentSearchDashboard` 함수 바로 앞에 계산 함수 추가:

```js
async function computeTalentSearchDashboardCounts(projects){
  const approved = projects.filter(p => p.status === 'approved' && p.policyVersionId);
  if(!approved.length) return {};

  let versions = [];
  try{
    const res = await apiGet('/talent-search-policy/versions');
    versions = res.versions;
  }catch(err){ /* 못 가져오면 아래에서 전부 0으로 처리 */ }

  const counts = {};
  await Promise.all(approved.map(async p => {
    try{
      const { candidates } = await apiGet('/talent-search-projects/'+p.id+'/candidates');
      const policy = versions.find(v=>v.id===p.policyVersionId);
      if(!policy || !candidates.length){ counts[p.id] = 0; return; }
      let recommended = 0;
      candidates.forEach(c => {
        if(tsManualStatusLabel(c.manualStatus)) return;
        if(simulateCandidate(c, policy).verdict === '추천') recommended++;
      });
      counts[p.id] = recommended;
    }catch(err){
      counts[p.id] = 0;
    }
  }));
  return counts;
}
```

- [ ] **Step 2**: `renderTalentSearchDashboard`를 아래로 교체(현재 프로젝트 목록을 받은 다음 카운트를 계산하고, "누적 추천" 값에 반영):

현재:
```js
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

교체 후:
```js
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

  const cumulativeCounts = await computeTalentSearchDashboardCounts(projects);

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
            <div class="kpi" style="flex:1;margin-bottom:0;"><div class="label">누적 추천</div><div class="value">${cumulativeCounts[p.id] ?? 0} / ${p.targetRecommendCount}</div></div>
          </div>
        </div>
      `).join('')}
    </div>
  ` : `<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;font-size:12.5px;color:var(--sub);">아직 만든 검색 프로젝트가 없어요 — 위 "+ 새 인재검색"으로 시작해보세요.</div>`;

  el.innerHTML = `<button class="btn primary sm" style="margin-bottom:14px;" onclick="openNewTalentSearchForm()">+ 새 인재검색</button>${listHtml}`;
}
```

- [ ] **Step 3**: 수동 확인. 대시보드에서 승인+후보생성된 프로젝트 카드의 "누적 추천"이 실제 추천 인원 수와 일치하는지(검색 진행 화면에서 본 "추천" 카운트와 비교), draft 프로젝트나 후보 없는 프로젝트는 여전히 0으로 보이는지, 어떤 후보를 "정보 부족"/"중복"으로 수동표시한 프로젝트는 그 후보가 카운트에서 빠지는지 확인.

- [ ] **Step 4**: `git add index.html && git commit -m "feat: 대시보드 카드 누적 추천 숫자를 실제 후보 데이터로 계산"`

---

## Self-Review

새 API/스키마 없음(제약 그대로). `tsManualStatusLabel`/`simulateCandidate` 기존 함수 재사용, 새 채점 로직 없음. 플레이스홀더 없음.
