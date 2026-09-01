# 인재검색 화면 5단계 재구성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "인재검색" 화면을 탭+깊은 네비게이션 구조에서, 카드(단계 배지)로 된 목록 + 클릭하면 열리는 프로젝트별 5단계 세로 화면 구조로 재구성한다. 새 기능 추가가 아니라 이미 만든 기능(조건저장/검색실행 안내/수집현황/직무60점 채점표)을 재배치하는 것이다.

**Architecture:** 서버는 `role_title` 필수 제약만 완화한다(마이그레이션 1개). `index.html`은 (1) "새 인재검색" 폼에서 자동화에 안 쓰이는 필드를 제거하고, (2) 프로젝트 단계를 계산하는 새 순수 함수를 만들어 대시보드 카드와 상세 화면 양쪽에서 재사용하고, (3) 기존에 따로 있던 화면(조건 검토, 검색 진행, 실제 후보 리스트)을 하나의 세로 스크롤 화면으로 합친다. 기존 "실제 후보 리스트" 렌더링 함수(`loadTalentSearchListCandidates`/`renderTsListCandidatesTable` 등)는 한 글자도 안 고치고 새 화면의 4번째 블록 안에 그대로 마운트한다. 가상 후보 시뮬레이션 화면은 그대로 유지하되 진입 경로만 보조 링크로 옮긴다.

**Tech Stack:** Node.js ESM 서버리스 핸들러, `@neondatabase/serverless`, Vanilla JS(`index.html`).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-28-talent-search-workflow-redesign-design.md`.
- **선행 조건**: `docs/superpowers/plans/2026-08-28-talent-search-auto-search-execution.md`의 Task 1(`GET /talent-search-projects` 응답에 `keywords` 필드 노출)이 먼저 적용돼 있어야 한다 — 이 계획의 Task 3이 대시보드 카드 단계 계산에서 `p.keywords`를 읽는다. 아직 적용 안 됐다면 이 계획의 Task 3 시작 전에 그 태스크를 먼저 실행한다.
- 새 기능 추가 없음 — 화면 재배치 + 안 쓰이는 폼 필드 삭제만.
- 단계 판정은 서버에 새로 저장하지 않고 클라이언트가 매번 계산(이 프로젝트의 "서버는 원본만" 원칙).
- 단계 배지·판정 로직에 플랫폼 이름(예: "사람인")을 하드코딩하지 않는다 — 나중에 다른 플랫폼이 추가돼도 이 로직은 그대로 쓴다.
- 가상 후보 채점 로직(`simulateCandidate`, `evaluateLevel1` 등)과 실제 후보 채점 로직(`scoreListCandidateJobFit`)은 이번 계획의 어떤 태스크에서도 수정하지 않는다 — 화면에 배치되는 위치만 바뀐다.
- API 응답 camelCase, DB 컬럼 snake_case. 커밋 메시지는 한국어.

---

### Task 1: 서버 — `role_title` 필수 제약 완화

**Files:**
- Create: `sql/022_talent_search_role_title_optional.sql`
- Modify: `handlers/_lib/talentSearchProjectValidate.js`
- Modify: `handlers/_lib/talentSearchProjectValidate.test.js`
- Modify: `handlers/talent-search-projects/index.js`

**Interfaces:**
- Produces: `POST /api/talent-search-projects`가 `roleTitle`/`employmentType`/`headcount` 없이도 성공한다(다른 계획·화면이 이 셋을 필수로 가정하지 않게 됨). Task 2가 이 완화된 검증에 의존한다.

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- sql/022_talent_search_role_title_optional.sql
--
-- 2026-08-28: 인재검색 화면 재구성. "새 인재검색" 폼에서 채용
-- 직무/포지션명(role_title) 입력을 없애기로 해서(자동화에 안 쓰이고
-- 다른 화면 표시용으로만 쓰이던 필드), NOT NULL 제약을 풀어야 새
-- 프로젝트를 이 값 없이 저장할 수 있다. 기존 행의 값은 그대로 둔다.
ALTER TABLE talent_search_projects ALTER COLUMN role_title DROP NOT NULL;
```

- [ ] **Step 2: 마이그레이션 적용 (development 브랜치)**

Run: `node scripts/run-sql.js sql/022_talent_search_role_title_optional.sql`
Expected: 에러 없이 완료. `.env.local`이 `development` 브랜치를 가리키는지 먼저 확인.

- [ ] **Step 3: 검증 로직에서 필수 체크 제거**

`handlers/_lib/talentSearchProjectValidate.js`의 `validateTalentSearchProjectInput` 함수 — 현재:

```js
  if (!isNonEmptyString(body.title)) return '검색 프로젝트명을 입력해주세요';
  if (!isNonEmptyString(body.roleTitle)) return '채용 직무/포지션명을 입력해주세요';
  if (!isNonEmptyString(body.employmentType)) return '고용형태를 입력해주세요';
  if (!isPositiveInt(body.headcount)) return '채용인원은 1명 이상의 정수여야 해요';
  if (!isPositiveInt(body.targetRecommendCount)) return '총 적합 추천 목표 인원은 1명 이상의 정수여야 해요';
```

아래로 교체(title/targetRecommendCount 체크만 남김):

```js
  if (!isNonEmptyString(body.title)) return '검색 프로젝트명을 입력해주세요';
  if (!isPositiveInt(body.targetRecommendCount)) return '총 적합 추천 목표 인원은 1명 이상의 정수여야 해요';
```

- [ ] **Step 4: 테스트 갱신**

`handlers/_lib/talentSearchProjectValidate.test.js`에서 아래 테스트 전체를 삭제(더 이상 성립하지 않는 체크):

```js
test('validateTalentSearchProjectInput: headcount가 0이면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, headcount: 0 }));
});
```

`VALID` 픽스처는 그대로 둬도 된다(roleTitle/employmentType/headcount가 있어도 무해 — 그냥 검증 대상이 아닐 뿐).

- [ ] **Step 5: 테스트 실행**

Run: `node --test handlers/_lib/talentSearchProjectValidate.test.js`
Expected: 남은 테스트 전부 PASS

- [ ] **Step 6: INSERT 쿼리가 없는 값도 안전하게 넣도록 수정**

`handlers/talent-search-projects/index.js`의 POST 핸들러 INSERT 문 — 현재:

```js
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
```

아래로 교체(`roleTitle`/`employmentType`/`headcount`를 없어도 되는 값으로 다룸):

```js
      const [row] = await sql`
        INSERT INTO talent_search_projects (
          title, role_title, seniority_level, experience_min_years, experience_max_years,
          employment_type, headcount, location, work_conditions, natural_language_brief,
          keywords, clarification_notes, target_recommend_count, platforms, created_by
        ) VALUES (
          ${body.title.trim()}, ${body.roleTitle ? body.roleTitle.trim() : null}, ${body.seniorityLevel || null},
          ${body.experienceMinYears ?? null}, ${body.experienceMaxYears ?? null},
          ${body.employmentType ? body.employmentType.trim() : null}, ${body.headcount ?? null}, ${body.location || null},
          ${JSON.stringify(body.workConditions || {})}::jsonb, ${body.naturalLanguageBrief || null},
          ${JSON.stringify(keywords)}::jsonb, ${JSON.stringify(body.clarificationNotes || [])}::jsonb,
          ${body.targetRecommendCount}, ${JSON.stringify(body.platforms)}::jsonb, ${account.id}
        ) RETURNING id`;
```

- [ ] **Step 7: 로컬 dev 서버로 수동 검증**

로그인된 브라우저 콘솔에서, `roleTitle`/`employmentType`/`headcount` 없이 프로젝트가 만들어지는지 확인:

```js
fetch('/api/talent-search-projects', {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ title:'__테스트__역할없음', targetRecommendCount:5, platforms:['사람인'], keywords:{include:['테스트'],or:[],exact:[],exclude:[],preferred:[]} })
}).then(r=>r.json()).then(console.log)
```

`{ id: "..." }` 확인 후, 확인에 쓴 프로젝트는 `DELETE FROM talent_search_projects WHERE title = '__테스트__역할없음'`로 정리.

- [ ] **Step 8: 커밋**

```bash
git add sql/022_talent_search_role_title_optional.sql handlers/_lib/talentSearchProjectValidate.js handlers/_lib/talentSearchProjectValidate.test.js handlers/talent-search-projects/index.js
git commit -m "$(cat <<'EOF'
feat: 검색 프로젝트 생성 시 role_title/employmentType/headcount 필수 해제

화면 재구성으로 "새 인재검색" 폼에서 이 필드들의 입력을 없애기로
해서, 서버 검증·DB 제약도 함께 완화한다. 기존 데이터는 그대로 둔다.
EOF
)"
```

---

### Task 2: `index.html` — "새 인재검색" 폼 필드 정리

**Files:** Modify `index.html`

**Interfaces:**
- Consumes: Task 1의 완화된 검증(roleTitle/employmentType/headcount 없이 POST 가능).

- [ ] **Step 1: `tsProjectDraft` 초기값에서 삭제 필드 제거**

현재:

```js
async function openNewTalentSearchForm(){
  tsProjectDraft = {
    title:'', roleTitle:'', seniorityLevel:'', experienceMinYears:'', experienceMaxYears:'',
    employmentType:'', headcount:'', location:'',
    workConditions:{ expectedStartDate:'', salaryRange:'', workArrangement:'', requiredQualifications:'', avoidConditions:'' },
    naturalLanguageBrief:'',
    keywords:{ include:'', or:'', exact:'', exclude:'', preferred:'' },
    targetRecommendCount:'', platforms:[],
    saveAsTemplate:false, templateName:''
  };
```

아래로 교체:

```js
async function openNewTalentSearchForm(){
  tsProjectDraft = {
    title:'', experienceMinYears:'', experienceMaxYears:'',
    keywords:{ include:'', or:'', exact:'', exclude:'', preferred:'' },
    targetRecommendCount:'', platforms:[],
    saveAsTemplate:false, templateName:''
  };
```

- [ ] **Step 2: 플랫폼 선택지를 사람인만 남기는 상수 추가**

`const TS_PLATFORMS = ['사람인', '잡코리아', '리멤버', '원티드'];` 줄 바로 다음에 추가(기존 상수는 안 지운다 — 대시보드 카드에서 과거 프로젝트의 플랫폼 칩을 그대로 보여줄 때 여전히 쓰인다):

```js
// "새 인재검색" 폼에서 실제로 선택 가능한 플랫폼. 지금은 사람인만
// 실행엔진(크롬 확장)이 있어서 나머지 3개는 체크해도 아무 기능이
// 없다 -- 그 플랫폼용 실행엔진이 생기면 이 배열에 추가하기만 하면
// 된다(TS_PLATFORMS 자체는 안 바꿔도 됨, DB·검증 로직은 이미
// 4개를 다 허용하고 있음).
const TS_PLATFORMS_ENABLED = ['사람인'];
```

- [ ] **Step 3: 폼 렌더링에서 필드 제거**

`renderNewTalentSearchForm` 함수 전체 — 현재:

```js
function renderNewTalentSearchForm(){
  const d = tsProjectDraft;
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `
    <div class="field"><label>직무 템플릿 불러오기</label>
      <select id="f-ts-template-load" onchange="loadTemplateIntoForm(this.value)">
        <option value="">선택 안 함</option>
        ${tsJobTemplates.map((t,i)=>`<option value="${i}">${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>검색 프로젝트명</label><input id="f-ts-title" value="${escapeHtml(d.title)}" placeholder="예: 2026년 8월 리빙MD 채용"></div>
    <div class="form-row">
      <div class="field"><label>채용 직무/포지션명</label><input id="f-ts-role" value="${escapeHtml(d.roleTitle)}" placeholder="예: 리빙상품 기획MD"></div>
      <div class="field"><label>직급/역할수준</label><input id="f-ts-level" value="${escapeHtml(d.seniorityLevel)}" placeholder="예: 대리급"></div>
    </div>
    <div class="form-row3">
      <div class="field"><label>희망 경력(최소, 년)</label><input id="f-ts-expmin" type="number" min="0" value="${escapeHtml(String(d.experienceMinYears))}"></div>
      <div class="field"><label>희망 경력(최대, 년)</label><input id="f-ts-expmax" type="number" min="0" value="${escapeHtml(String(d.experienceMaxYears))}"></div>
      <div class="field"><label>고용형태</label><input id="f-ts-employment" value="${escapeHtml(d.employmentType)}" placeholder="예: 정규직"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>채용인원</label><input id="f-ts-headcount" type="number" min="1" value="${escapeHtml(String(d.headcount))}"></div>
      <div class="field"><label>근무지역</label><input id="f-ts-location" value="${escapeHtml(d.location)}" placeholder="예: 서울"></div>
    </div>
    <div class="field"><label>찾고 싶은 사람 (자연어로 설명해주세요)</label><textarea id="f-ts-brief" style="min-height:120px;" placeholder="예: 이커머스 리빙상품 기획MD 대리급을 찾는다. 시장조사만 한 사람보다 실제 상품 출시와 리오더를 끝까지 운영한 사람이 필요하다.">${escapeHtml(d.naturalLanguageBrief)}</textarea></div>
    <div class="form-row">
      <div class="field"><label>반드시 포함할 키워드 (쉼표로 구분)</label><input id="f-ts-kw-include" value="${escapeHtml(d.keywords.include)}"></div>
      <div class="field"><label>OR 검색 키워드 (쉼표로 구분)</label><input id="f-ts-kw-or" value="${escapeHtml(d.keywords.or)}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>정확히 일치할 문구 (쉼표로 구분)</label><input id="f-ts-kw-exact" value="${escapeHtml(d.keywords.exact)}"></div>
      <div class="field"><label>제외할 키워드 (쉼표로 구분)</label><input id="f-ts-kw-exclude" value="${escapeHtml(d.keywords.exclude)}"></div>
    </div>
    <div class="field"><label>우대 키워드 (쉼표로 구분)</label><input id="f-ts-kw-preferred" value="${escapeHtml(d.keywords.preferred)}"></div>
    <div class="form-row">
      <div class="field"><label>총 적합 추천 목표 인원</label><input id="f-ts-target" type="number" min="1" value="${escapeHtml(String(d.targetRecommendCount))}"></div>
      <div class="field"><label>검색할 플랫폼</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;">
          ${TS_PLATFORMS.map((p,i)=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;"><input type="checkbox" id="f-ts-platform-${i}" ${d.platforms.includes(p)?'checked':''}> ${p}</label>`).join('')}
        </div>
      </div>
    </div>
    <details style="margin:14px 0;">
      <summary style="cursor:pointer;font-weight:700;font-size:13px;">상세조건 (선택, 안 채워도 감점되지 않아요)</summary>
      <div class="form-row" style="margin-top:10px;">
        <div class="field"><label>희망 입사가능 시점</label><input id="f-ts-startdate" value="${escapeHtml(d.workConditions.expectedStartDate)}"></div>
        <div class="field"><label>연봉·보상 범위</label><input id="f-ts-salary" value="${escapeHtml(d.workConditions.salaryRange)}"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>출근/재택/출장 조건</label><input id="f-ts-arrangement" value="${escapeHtml(d.workConditions.workArrangement)}"></div>
        <div class="field"><label>필수 자격·언어·포트폴리오</label><input id="f-ts-quals" value="${escapeHtml(d.workConditions.requiredQualifications)}"></div>
      </div>
      <div class="field"><label>반드시 피해야 할 업무환경/경력유형</label><input id="f-ts-avoid" value="${escapeHtml(d.workConditions.avoidConditions)}"></div>
    </details>
    <div style="margin:10px 0;">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
        <input type="checkbox" id="f-ts-savetemplate" ${d.saveAsTemplate?'checked':''} onchange="tsProjectDraft.saveAsTemplate=this.checked; renderTsTemplateNameField();">
        이 조건을 직무 템플릿으로도 저장
      </label>
    </div>
    <div id="ts-template-name-field">${d.saveAsTemplate ? `<div class="field"><label>템플릿 이름</label><input id="f-ts-templatename" value="${escapeHtml(d.templateName)}" placeholder="예: 리빙MD 대리급"></div>` : ''}</div>
    <div id="ts-form-error" style="display:none;color:var(--red);font-size:12.5px;margin:10px 0;"></div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn" onclick="switchTalentSearchTab('dashboard')">취소</button>
      <button class="btn primary" onclick="submitNewTalentSearchProject()">검색기준 만들기</button>
    </div>
  `;
}
```

아래로 교체:

```js
function renderNewTalentSearchForm(){
  const d = tsProjectDraft;
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `
    <div class="field"><label>직무 템플릿 불러오기</label>
      <select id="f-ts-template-load" onchange="loadTemplateIntoForm(this.value)">
        <option value="">선택 안 함</option>
        ${tsJobTemplates.map((t,i)=>`<option value="${i}">${escapeHtml(t.name)}</option>`).join('')}
      </select>
    </div>
    <div class="field"><label>검색 프로젝트명</label><input id="f-ts-title" value="${escapeHtml(d.title)}" placeholder="예: 2026년 8월 리빙MD 채용"></div>
    <div class="form-row">
      <div class="field"><label>희망 경력(최소, 년)</label><input id="f-ts-expmin" type="number" min="0" value="${escapeHtml(String(d.experienceMinYears))}"></div>
      <div class="field"><label>희망 경력(최대, 년)</label><input id="f-ts-expmax" type="number" min="0" value="${escapeHtml(String(d.experienceMaxYears))}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>🔍 반드시 포함할 키워드 (검색에 사용, 쉼표로 구분)</label><input id="f-ts-kw-include" value="${escapeHtml(d.keywords.include)}"></div>
      <div class="field"><label>🔍 OR 검색 키워드 (검색에 사용, 쉼표로 구분)</label><input id="f-ts-kw-or" value="${escapeHtml(d.keywords.or)}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>🔍 정확히 일치할 문구 (검색에 사용, 쉼표로 구분)</label><input id="f-ts-kw-exact" value="${escapeHtml(d.keywords.exact)}"></div>
      <div class="field"><label>🔍 제외할 키워드 (검색에 사용, 쉼표로 구분)</label><input id="f-ts-kw-exclude" value="${escapeHtml(d.keywords.exclude)}"></div>
    </div>
    <div class="field"><label>⭐ 우대 키워드 (채점에만 사용, 검색엔 안 씀 · 쉼표로 구분)</label><input id="f-ts-kw-preferred" value="${escapeHtml(d.keywords.preferred)}"></div>
    <div class="form-row">
      <div class="field"><label>총 적합 추천 목표 인원</label><input id="f-ts-target" type="number" min="1" value="${escapeHtml(String(d.targetRecommendCount))}"></div>
      <div class="field"><label>검색할 플랫폼</label>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;">
          ${TS_PLATFORMS_ENABLED.map((p,i)=>`<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;"><input type="checkbox" id="f-ts-platform-${i}" ${d.platforms.includes(p)?'checked':''}> ${p}</label>`).join('')}
        </div>
      </div>
    </div>
    <div style="margin:10px 0;">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
        <input type="checkbox" id="f-ts-savetemplate" ${d.saveAsTemplate?'checked':''} onchange="tsProjectDraft.saveAsTemplate=this.checked; renderTsTemplateNameField();">
        이 조건을 직무 템플릿으로도 저장
      </label>
    </div>
    <div id="ts-template-name-field">${d.saveAsTemplate ? `<div class="field"><label>템플릿 이름</label><input id="f-ts-templatename" value="${escapeHtml(d.templateName)}" placeholder="예: 리빙MD 대리급"></div>` : ''}</div>
    <div id="ts-form-error" style="display:none;color:var(--red);font-size:12.5px;margin:10px 0;"></div>
    <div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn" onclick="switchTalentSearchTab('dashboard')">취소</button>
      <button class="btn primary" onclick="submitNewTalentSearchProject()">검색기준 만들기</button>
    </div>
  `;
}
```

(참고: `TS_PLATFORMS.map(...)`가 `TS_PLATFORMS_ENABLED.map(...)`로 바뀐 것에 주의 — 인덱스 `i`가 `TS_PLATFORMS_ENABLED` 배열 기준이 되므로 `f-ts-platform-0`이 곧 "사람인"이다. `captureNewTalentSearchForm`(다음 스텝)도 같은 배열을 참조해야 인덱스가 맞는다.)

- [ ] **Step 4: `loadTemplateIntoForm`에서 삭제 필드 제거**

현재:

```js
  captureNewTalentSearchForm();
  const c = t.criteria || {};
  tsProjectDraft = {
    ...tsProjectDraft,
    roleTitle: c.roleTitle || '',
    seniorityLevel: c.seniorityLevel || '',
    experienceMinYears: c.experienceMinYears ?? '',
    experienceMaxYears: c.experienceMaxYears ?? '',
    employmentType: c.employmentType || '',
    headcount: c.headcount ?? '',
    location: c.location || '',
    workConditions: c.workConditions || tsProjectDraft.workConditions,
    naturalLanguageBrief: c.naturalLanguageBrief || '',
    keywords: {
      include: (c.keywords?.include || []).join(', '),
      or: (c.keywords?.or || []).join(', '),
      exact: (c.keywords?.exact || []).join(', '),
      exclude: (c.keywords?.exclude || []).join(', '),
      preferred: (c.keywords?.preferred || []).join(', ')
    },
    targetRecommendCount: c.targetRecommendCount ?? '',
    platforms: c.platforms || []
  };
  renderNewTalentSearchForm();
```

아래로 교체(과거에 만들어진 템플릿에 roleTitle 등 옛 필드가 남아있어도 그냥 무시하고, 지금도 유효한 필드만 가져온다):

```js
  captureNewTalentSearchForm();
  const c = t.criteria || {};
  tsProjectDraft = {
    ...tsProjectDraft,
    experienceMinYears: c.experienceMinYears ?? '',
    experienceMaxYears: c.experienceMaxYears ?? '',
    keywords: {
      include: (c.keywords?.include || []).join(', '),
      or: (c.keywords?.or || []).join(', '),
      exact: (c.keywords?.exact || []).join(', '),
      exclude: (c.keywords?.exclude || []).join(', '),
      preferred: (c.keywords?.preferred || []).join(', ')
    },
    targetRecommendCount: c.targetRecommendCount ?? '',
    platforms: (c.platforms || []).filter(p => TS_PLATFORMS_ENABLED.includes(p))
  };
  renderNewTalentSearchForm();
```

- [ ] **Step 5: `captureNewTalentSearchForm`에서 삭제 필드 제거**

현재:

```js
function captureNewTalentSearchForm(){
  const d = tsProjectDraft;
  d.title = document.getElementById('f-ts-title').value;
  d.roleTitle = document.getElementById('f-ts-role').value;
  d.seniorityLevel = document.getElementById('f-ts-level').value;
  d.experienceMinYears = document.getElementById('f-ts-expmin').value;
  d.experienceMaxYears = document.getElementById('f-ts-expmax').value;
  d.employmentType = document.getElementById('f-ts-employment').value;
  d.headcount = document.getElementById('f-ts-headcount').value;
  d.location = document.getElementById('f-ts-location').value;
  d.naturalLanguageBrief = document.getElementById('f-ts-brief').value;
  d.keywords.include = document.getElementById('f-ts-kw-include').value;
  d.keywords.or = document.getElementById('f-ts-kw-or').value;
  d.keywords.exact = document.getElementById('f-ts-kw-exact').value;
  d.keywords.exclude = document.getElementById('f-ts-kw-exclude').value;
  d.keywords.preferred = document.getElementById('f-ts-kw-preferred').value;
  d.targetRecommendCount = document.getElementById('f-ts-target').value;
  d.platforms = TS_PLATFORMS.filter((p,i)=>document.getElementById('f-ts-platform-'+i).checked);
  d.workConditions = {
    expectedStartDate: document.getElementById('f-ts-startdate').value,
    salaryRange: document.getElementById('f-ts-salary').value,
    workArrangement: document.getElementById('f-ts-arrangement').value,
    requiredQualifications: document.getElementById('f-ts-quals').value,
    avoidConditions: document.getElementById('f-ts-avoid').value
  };
  d.saveAsTemplate = document.getElementById('f-ts-savetemplate').checked;
  const nameEl = document.getElementById('f-ts-templatename');
  d.templateName = nameEl ? nameEl.value : '';
}
```

아래로 교체:

```js
function captureNewTalentSearchForm(){
  const d = tsProjectDraft;
  d.title = document.getElementById('f-ts-title').value;
  d.experienceMinYears = document.getElementById('f-ts-expmin').value;
  d.experienceMaxYears = document.getElementById('f-ts-expmax').value;
  d.keywords.include = document.getElementById('f-ts-kw-include').value;
  d.keywords.or = document.getElementById('f-ts-kw-or').value;
  d.keywords.exact = document.getElementById('f-ts-kw-exact').value;
  d.keywords.exclude = document.getElementById('f-ts-kw-exclude').value;
  d.keywords.preferred = document.getElementById('f-ts-kw-preferred').value;
  d.targetRecommendCount = document.getElementById('f-ts-target').value;
  d.platforms = TS_PLATFORMS_ENABLED.filter((p,i)=>document.getElementById('f-ts-platform-'+i).checked);
  d.saveAsTemplate = document.getElementById('f-ts-savetemplate').checked;
  const nameEl = document.getElementById('f-ts-templatename');
  d.templateName = nameEl ? nameEl.value : '';
}
```

- [ ] **Step 6: 추가질문 트리거에서 자연어설명 조건 제거**

`computeClarificationQuestions` 함수 — 현재:

```js
function computeClarificationQuestions(d){
  const qs = [];
  if(!d.naturalLanguageBrief || d.naturalLanguageBrief.trim().length < 30){
    qs.push('이 직무에서 반드시 확인해야 할 과거 성과나 경험이 있다면 설명해주세요');
  }
  if(!splitKeywords(d.keywords.include).length){
    qs.push('반드시 포함되어야 할 키워드가 있다면 알려주세요');
  }
  if(!splitKeywords(d.keywords.exclude).length){
    qs.push('반드시 피해야 할 경력유형이나 업무환경이 있나요?');
  }
  return qs.slice(0, 3);
}
```

아래로 교체:

```js
function computeClarificationQuestions(d){
  const qs = [];
  if(!splitKeywords(d.keywords.include).length){
    qs.push('반드시 포함되어야 할 키워드가 있다면 알려주세요');
  }
  if(!splitKeywords(d.keywords.exclude).length){
    qs.push('반드시 피해야 할 경력유형이나 업무환경이 있나요?');
  }
  return qs.slice(0, 3);
}
```

- [ ] **Step 7: 제출 검증에서 삭제 필드 체크 제거**

`submitNewTalentSearchProject` 함수 — 현재:

```js
function submitNewTalentSearchProject(){
  captureNewTalentSearchForm();
  const d = tsProjectDraft;
  if(!d.title.trim()) return showTsFormError('검색 프로젝트명을 입력해주세요');
  if(!d.roleTitle.trim()) return showTsFormError('채용 직무/포지션명을 입력해주세요');
  if(!d.employmentType.trim()) return showTsFormError('고용형태를 입력해주세요');
  if(!d.headcount || Number(d.headcount) < 1) return showTsFormError('채용인원을 1명 이상 입력해주세요');
  if(!d.targetRecommendCount || Number(d.targetRecommendCount) < 1) return showTsFormError('총 적합 추천 목표 인원을 1명 이상 입력해주세요');
  if(!d.platforms.length) return showTsFormError('검색할 플랫폼을 1개 이상 선택해주세요');
  if(d.saveAsTemplate && !d.templateName.trim()) return showTsFormError('템플릿 이름을 입력해주세요');
```

아래로 교체:

```js
function submitNewTalentSearchProject(){
  captureNewTalentSearchForm();
  const d = tsProjectDraft;
  if(!d.title.trim()) return showTsFormError('검색 프로젝트명을 입력해주세요');
  if(!d.targetRecommendCount || Number(d.targetRecommendCount) < 1) return showTsFormError('총 적합 추천 목표 인원을 1명 이상 입력해주세요');
  if(!d.platforms.length) return showTsFormError('검색할 플랫폼을 1개 이상 선택해주세요');
  if(d.saveAsTemplate && !d.templateName.trim()) return showTsFormError('템플릿 이름을 입력해주세요');
```

(이 함수의 나머지 부분(`tsClarifyQuestions = computeClarificationQuestions(d); ...`부터 끝까지)은 안 바뀐다.)

- [ ] **Step 8: 저장 payload에서 삭제 필드 제거**

`saveNewTalentSearchProject` 함수 — 현재:

```js
async function saveNewTalentSearchProject(clarificationNotes){
  const d = tsProjectDraft;
  const criteria = {
    roleTitle: d.roleTitle.trim(),
    seniorityLevel: d.seniorityLevel.trim() || null,
    experienceMinYears: d.experienceMinYears ? Number(d.experienceMinYears) : null,
    experienceMaxYears: d.experienceMaxYears ? Number(d.experienceMaxYears) : null,
    employmentType: d.employmentType.trim(),
    headcount: Number(d.headcount),
    location: d.location.trim() || null,
    workConditions: d.workConditions,
    naturalLanguageBrief: d.naturalLanguageBrief.trim() || null,
    keywords: {
      include: splitKeywords(d.keywords.include),
      or: splitKeywords(d.keywords.or),
      exact: splitKeywords(d.keywords.exact),
      exclude: splitKeywords(d.keywords.exclude),
      preferred: splitKeywords(d.keywords.preferred)
    },
    targetRecommendCount: Number(d.targetRecommendCount),
    platforms: d.platforms
  };
  const payload = { title: d.title.trim(), ...criteria, clarificationNotes };
```

아래로 교체:

```js
async function saveNewTalentSearchProject(clarificationNotes){
  const d = tsProjectDraft;
  const criteria = {
    experienceMinYears: d.experienceMinYears ? Number(d.experienceMinYears) : null,
    experienceMaxYears: d.experienceMaxYears ? Number(d.experienceMaxYears) : null,
    keywords: {
      include: splitKeywords(d.keywords.include),
      or: splitKeywords(d.keywords.or),
      exact: splitKeywords(d.keywords.exact),
      exclude: splitKeywords(d.keywords.exclude),
      preferred: splitKeywords(d.keywords.preferred)
    },
    targetRecommendCount: Number(d.targetRecommendCount),
    platforms: d.platforms
  };
  const payload = { title: d.title.trim(), ...criteria, clarificationNotes };
```

(이 함수의 나머지 부분은 안 바뀐다.)

- [ ] **Step 9: 로컬 dev 서버로 수동 검증**

1. 로그인 → "인재검색" → "+ 새 인재검색" 클릭
2. 화면에 직무/직급/고용형태/채용인원/근무지역/자연어설명/상세조건이 안 보이는지 확인
3. 키워드 라벨에 🔍/⭐ 표시가 붙어있는지 확인
4. 플랫폼 체크박스가 "사람인" 하나만 보이는지 확인
5. 프로젝트명 + 키워드만 채우고 저장 → 성공하는지 확인(포함 키워드를 비워두면 "추가질문" 모달이 뜨는지도 확인 — 자연어설명 관련 질문은 더 이상 안 뜸)
6. 만든 테스트 프로젝트 정리(DB에서 직접 삭제 또는 그대로 둬도 다음 태스크에서 재사용 가능)

- [ ] **Step 10: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: 새 인재검색 폼에서 자동화에 안 쓰이는 필드 삭제

직무/직급/고용형태/채용인원/근무지역/자연어설명/상세조건 5개를
제거하고, 남는 키워드 필드에 용도(검색/채점) 라벨을 붙인다.
플랫폼 선택은 지금 실행엔진이 있는 사람인만 노출한다.
EOF
)"
```

---

### Task 3: `index.html` — 프로젝트 단계 계산 + 대시보드 카드 재작성

**Files:** Modify `index.html`

**Interfaces:**
- Consumes: `scoreListCandidateJobFit(candidate, projectKeywords, policy)`(이미 있음), `GET /talent-search-policy/versions`(이미 있음), `GET /talent-search-projects/:id/list-candidates`(이미 있음), `p.keywords`(선행 조건 — 사람인 검색 실행 자동화 계획의 Task 1이 이미 적용돼 있어야 함).
- Produces: `computeTalentSearchProjectStage(project, listCandidates, policy)` → `{ stage: 1|2|3|4, recommendedCount: number }`(순수 함수, 이 프로젝트의 하나의 후보 집합에 대해 계산). `computeTalentSearchProjectStages(projects)` → `Promise<{[projectId]: {stage, recommendedCount}}>`(여러 프로젝트를 한 번에 계산, 필요한 API를 대신 호출). Task 4가 두 함수를 그대로 재사용한다.

- [ ] **Step 1: 단계 계산 순수 함수 추가**

`const TS_STATUS_LABEL = { draft: '작성중', approved: '승인됨' };` 줄 바로 다음에 추가:

```js
const TS_STAGE_LABEL = { 1: '조건 설정', 2: '검색 실행 대기', 3: '수집 중', 4: '적합/부적합 확인' };
const TS_STAGE_BADGE_CLASS = { 1: 'badge grey', 2: 'badge grey', 3: 'badge blue', 4: 'badge green' };

// 프로젝트 하나의 단계를 계산한다. 플랫폼 이름을 판정에 쓰지 않는다 --
// 어느 플랫폼에서 왔든 실제 후보가 1건이라도 있으면 2단계를 지난
//것으로 본다(설계문서의 "다른 플랫폼 확장 대비" 절 참고). "검색을
// 실행했다"는 사실 자체는 서버가 기록하지 않으므로, 그 결과(후보
// 유입)로 간접 판단한다.
function computeTalentSearchProjectStage(project, listCandidates, policy){
  if(project.status !== 'approved') return { stage: 1, recommendedCount: 0 };
  if(!listCandidates.length) return { stage: 2, recommendedCount: 0 };
  if(!policy) return { stage: 3, recommendedCount: 0 };

  let recommendedCount = 0;
  listCandidates.forEach(c => {
    if(scoreListCandidateJobFit(c, project.keywords, policy).verdict === '추천') recommendedCount++;
  });
  const stage = recommendedCount >= project.targetRecommendCount ? 4 : 3;
  return { stage, recommendedCount };
}

async function computeTalentSearchProjectStages(projects){
  const stages = {};
  const approved = projects.filter(p => p.status === 'approved');
  projects.forEach(p => { if(p.status !== 'approved') stages[p.id] = { stage: 1, recommendedCount: 0 }; });
  if(!approved.length) return stages;

  let versions = [];
  try{ const res = await apiGet('/talent-search-policy/versions'); versions = res.versions; }
  catch(err){ /* 못 가져오면 아래에서 정책 없음으로 처리 */ }

  await Promise.all(approved.map(async p => {
    try{
      const { candidates } = await apiGet('/talent-search-projects/'+p.id+'/list-candidates');
      const policy = versions.find(v => v.id === p.policyVersionId) || null;
      stages[p.id] = computeTalentSearchProjectStage(p, candidates, policy);
    }catch(err){
      stages[p.id] = { stage: 2, recommendedCount: 0 };
    }
  }));
  return stages;
}
```

- [ ] **Step 2: 대시보드 카드를 배지+진행률로 교체**

`renderTalentSearchDashboard` 함수 전체 — 현재:

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

아래로 교체(옛 가상후보 기준 `computeTalentSearchDashboardCounts`는 그대로 두되 카드에서는 더 이상 안 쓴다 — 가상 후보 미리보기 화면 자체는 유지되므로 그 함수도 지우지 않는다):

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

  const stages = await computeTalentSearchProjectStages(projects);

  const listHtml = projects.length ? `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
      ${projects.map(p=>{
        const s = stages[p.id] || { stage: 1, recommendedCount: 0 };
        return `
        <div class="section" style="margin-bottom:0;cursor:pointer;" onclick="openTalentSearchProjectFlow('${p.id}')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div style="font-size:15px;font-weight:800;">${escapeHtml(p.title)}</div>
            <span class="${TS_STAGE_BADGE_CLASS[s.stage]}">${s.stage}단계 · ${TS_STAGE_LABEL[s.stage]}${s.stage>=3 ? ` (${s.recommendedCount}/${p.targetRecommendCount})` : ''}</span>
          </div>
        </div>
      `;}).join('')}
    </div>
  ` : `<div style="padding:12px 14px;border:1px solid var(--border);border-radius:12px;font-size:12.5px;color:var(--sub);">아직 만든 검색 프로젝트가 없어요 — 위 "+ 새 인재검색"으로 시작해보세요.</div>`;

  el.innerHTML = `<button class="btn primary sm" style="margin-bottom:14px;" onclick="openNewTalentSearchForm()">+ 새 인재검색</button>${listHtml}`;
}
```

(`openTalentSearchProjectFlow`는 Task 4에서 만든다 — 이 태스크 시점엔 아직 없는 함수라 카드를 클릭하면 에러가 나는 게 정상이다. Task 4가 끝나야 카드 클릭이 완성된다.)

- [ ] **Step 3: 로컬 dev 서버로 수동 검증(부분)**

1. `/talent-search-projects` 목록 응답에 `keywords`가 있는지 먼저 확인(선행 조건 — 없으면 Global Constraints에 적힌 다른 계획의 Task 1을 먼저 실행)
2. "인재검색" 대시보드를 열어서 카드마다 단계 배지가 뜨는지 확인(작성중 프로젝트=1단계, 승인됐지만 후보 없음=2단계, 후보 있고 목표 미달=3단계+진행률, 목표 달성=4단계)
3. 카드를 클릭하면 아직 에러가 나는 게 정상(Task 4에서 고침) — 콘솔에 `openTalentSearchProjectFlow is not defined` 같은 에러만 나고 나머지 화면은 안 깨지는지 확인

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: 인재검색 대시보드 카드를 단계 배지로 재작성

프로젝트 상태+실제 후보 수집·채점 결과로 1~4단계를 계산해서
카드에 배지로 보여준다. 플랫폼 이름은 판정 로직에 안 쓴다.
카드 클릭은 다음 태스크에서 완성되는 openTalentSearchProjectFlow를
가리킨다(그때까지는 클릭 시 에러 — 다음 태스크로 이어짐).
EOF
)"
```

---

### Task 4: `index.html` — 프로젝트 상세를 5단계 세로 화면으로 통합

**Files:** Modify `index.html`

**Interfaces:**
- Consumes: `computeTalentSearchProjectStage`(Task 3), `loadTalentSearchListCandidates(projectId, project, policy)`(기존, 무수정), `tsTagChips`/`renderLevel1Body`/`renderPointsListBody`/`renderEvidenceBody`/`renderThresholdsBody`(기존, 무수정).
- Produces: `openTalentSearchProjectFlow(id)` — 대시보드 카드 클릭 시 열리는 새 진입점(Task 3이 이미 이 이름으로 카드 onclick을 걸어뒀다). `openVirtualCandidatePreview(projectId)` — 기존 가상후보 화면(실제 후보 리스트 부분은 뺀 버전)의 새 진입점.

- [ ] **Step 1: `openTalentSearchProjectDetail`을 `openTalentSearchProjectFlow`로 교체**

`openTalentSearchProjectDetail` 함수 전체(그 함수가 시작하는 `async function openTalentSearchProjectDetail(id){`부터, 끝나는 `}` — 바로 다음 함수인 `async function openTalentSearchCandidates(projectId){` 시작 전까지)를 아래로 통째 교체:

```js
async function openTalentSearchProjectFlow(id){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button><div style="color:var(--sub);font-size:13px;">불러오는 중...</div>`;

  let project, listCandidatesRes;
  try{
    [project, listCandidatesRes] = await Promise.all([
      apiGet('/talent-search-projects/'+id),
      apiGet('/talent-search-projects/'+id+'/list-candidates')
    ]);
  }catch(err){
    el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button><div class="section">${escapeHtml(err.message)}</div>`;
    return;
  }
  const listCandidates = listCandidatesRes.candidates;

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

  const { stage, recommendedCount } = computeTalentSearchProjectStage(project, listCandidates, policy);
  const p = project;

  // 블록 1: 조건 설정
  const step1Done = p.status === 'approved';
  const step1Body = step1Done ? `
    <div style="font-size:13px;margin-bottom:8px;">경력 ${p.experienceMinYears??'?'}~${p.experienceMaxYears??'?'}년 · 목표 ${p.targetRecommendCount}명 · ${tsTagChips(p.platforms)}</div>
    <div style="font-size:12.5px;color:var(--sub);">필수 ${tsTagChips(p.keywords?.include)} · OR ${tsTagChips(p.keywords?.or)} · 정확일치 ${tsTagChips(p.keywords?.exact)} · 제외 ${tsTagChips(p.keywords?.exclude)} · 우대 ${tsTagChips(p.keywords?.preferred)}</div>
  ` : `
    <div style="font-size:13px;margin-bottom:10px;">경력 ${p.experienceMinYears??'?'}~${p.experienceMaxYears??'?'}년 · 목표 ${p.targetRecommendCount}명 · ${tsTagChips(p.platforms)}</div>
    <div style="font-size:12.5px;color:var(--sub);margin-bottom:10px;">필수 ${tsTagChips(p.keywords?.include)} · OR ${tsTagChips(p.keywords?.or)} · 정확일치 ${tsTagChips(p.keywords?.exact)} · 제외 ${tsTagChips(p.keywords?.exclude)} · 우대 ${tsTagChips(p.keywords?.preferred)}</div>
    <button class="btn primary sm" onclick="approveTalentSearchProject('${p.id}')">이 조건으로 검색</button>
  `;

  // 블록 2: 검색 실행 (플랫폼별 한 줄 — 지금 실행엔진 있는 플랫폼만 안내, 나머지는 회색)
  const step2Done = listCandidates.length > 0;
  const step2Rows = (p.platforms || []).map(pl => {
    const supported = TS_PLATFORMS_ENABLED.includes(pl);
    if(!supported) return `<div style="font-size:13px;color:var(--sub);margin-bottom:4px;">${escapeHtml(pl)}: 아직 지원 안 함</div>`;
    return step2Done
      ? `<div style="font-size:13px;margin-bottom:4px;">${escapeHtml(pl)}: 가져온 후보 있음 ✓</div>`
      : `<div style="font-size:13px;margin-bottom:4px;">${escapeHtml(pl)}: 크롬 확장에서 "목표 인원 채우기"를 눌러주세요 — <a href="javascript:void(0)" onclick="switchTalentSearchTab('connect')" style="color:var(--primary);text-decoration:underline;">연결 코드 확인</a></div>`;
  }).join('');

  // 블록 3: 수집 중 (진행률만 요약) — recommendedCount는 위에서 이미 계산해둔 값을 재사용한다(같은 계산을 두 번 안 함)
  const progressPct = p.targetRecommendCount ? Math.min(100, Math.round(recommendedCount / p.targetRecommendCount * 100)) : 0;
  const step3Body = `
    <div style="font-size:13px;margin-bottom:6px;">추천 ${recommendedCount}명 / 목표 ${p.targetRecommendCount}명</div>
    <div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;"><div style="height:100%;width:${progressPct}%;background:var(--primary);border-radius:4px;"></div></div>
    <div style="margin-top:8px;"><a href="javascript:void(0)" onclick="openVirtualCandidatePreview('${p.id}')" style="font-size:12.5px;color:var(--sub);text-decoration:underline;">가상 후보로 미리 테스트해보기 →</a></div>
  `;

  function stageBlock(n, title, bodyHtml){
    const done = n < stage;
    const active = n === stage;
    const border = done ? '2px solid var(--primary)' : active ? '2px solid var(--primary)' : '2px dashed var(--border)';
    const badge = done ? '✓' : active ? '●' : n;
    const opacity = (!done && !active) ? 'opacity:.55;' : '';
    return `
      <div class="section" style="border:${border};${opacity}">
        <div class="section-head"><h3>${badge} ${n}단계 · ${escapeHtml(title)}</h3></div>
        ${(done || active) ? bodyHtml : '<div style="font-size:12.5px;color:var(--sub);">이전 단계가 끝나면 진행할 수 있어요</div>'}
      </div>
    `;
  }

  el.innerHTML = `
    <button class="btn ghost sm" style="margin-bottom:14px;" onclick="switchTalentSearchTab('dashboard')">← 목록으로</button>
    <div class="page-head" style="padding:0 0 10px;"><div><h1 style="font-size:19px;">${escapeHtml(p.title)}</h1></div></div>
    ${stageBlock(1, '조건 설정', step1Body)}
    ${stageBlock(2, '검색 실행', step2Rows || '<div style="font-size:12.5px;color:var(--sub);">선택된 플랫폼이 없어요</div>')}
    ${stageBlock(3, '수집 중', step3Body)}
    <div class="section" style="border:${stage>=4?'2px solid var(--primary)':'2px dashed var(--border)'};${stage<4?'opacity:.55;':''}">
      <div class="section-head"><h3>${stage>=4?'✓':'4'} 4단계 · 적합/부적합 확인</h3><div class="desc">이름을 클릭하면 원문 이력서로 이동해요(5단계 · 이력서 확인)</div></div>
      <div id="talentsearch-list-candidates-body">불러오는 중...</div>
    </div>
  `;
  loadTalentSearchListCandidates(id, project, policy);
}
```

- [ ] **Step 2: 옛 가상후보 화면을 실제 후보 리스트 없이 남기는 새 진입점 추가**

`renderTalentSearchCandidatesScreen` 함수의 시그니처와 본문 — 현재 이 함수는 실제 후보 리스트 섹션(`listCandidatesSectionHtml`, `loadTalentSearchListCandidates` 호출)까지 같이 그리고 있다(2026-08-27~28에 이 함수에 그 부분을 붙였었다). 이제 그 부분은 Task 4 Step 1에서 만든 `openTalentSearchProjectFlow`가 전담하므로, 이 함수에서는 빼낸다.

현재(파일에서 `function renderTalentSearchCandidatesScreen(projectId, project, candidates, policy, policyLoadError){`로 시작하는 함수 전체 — `listCandidatesSectionHtml` 정의, 그 변수를 참조하는 3곳, 마지막 `loadTalentSearchListCandidates(projectId);` 호출까지 전부 포함):

```js
function renderTalentSearchCandidatesScreen(projectId, project, candidates, policy, policyLoadError){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;

  const backBtn = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="openTalentSearchProjectDetail('${projectId}')">← 뒤로</button>`;

  // "실제 후보 리스트" 섹션(크롬 확장으로 가져온 진짜 후보)은 가상
  // 후보 유무·채점기준 로딩 성공 여부와 완전히 무관한 별개 기능이라,
  // 아래 세 분기(가상후보 없음/채점기준 없음/정상) 중 어디로 가든
  // 항상 렌더링돼야 한다 -- 예전엔 각 분기가 el.innerHTML을 쓰고 바로
  // return해서, 가상 후보를 한 번도 안 만든 프로젝트에서는 이 섹션
  // 자체가 영영 안 뜨는 버그가 있었다(실사용 확인 중 발견).
  const listCandidatesSectionHtml = `
    <div class="section" id="talentsearch-list-candidates-section">
      <div class="section-head"><div><h3>실제 후보 리스트</h3><div class="desc">사람인 검색결과에서 크롬 확장으로 가져온 후보예요. 채점은 아직 안 하고, 정렬·필터만 돼요. 행을 클릭하면 원문 이력서로 이동해요.</div></div></div>
      <div id="talentsearch-list-candidates-body">불러오는 중...</div>
    </div>
  `;

  if(!candidates.length){
    el.innerHTML = `
      ${backBtn}
      <div class="section">
        <div class="section-head"><div><h3>${escapeHtml(project.title)} — 검색 진행</h3><div class="desc">아직 가상 후보를 생성하지 않았어요</div></div></div>
        <div style="font-size:12.5px;color:var(--sub);margin-bottom:10px;">가상 시뮬레이션이라 다시 생성할 때마다 결과가 달라져요.</div>
        <button class="btn primary sm" onclick="generateTalentSearchCandidates('${projectId}')">가상 후보 생성하기</button>
      </div>
      ${listCandidatesSectionHtml}
    `;
    loadTalentSearchListCandidates(projectId);
    return;
  }

  if(!policy){
    el.innerHTML = `${backBtn}<div class="section">${escapeHtml(policyLoadError || '채점 기준을 불러오지 못했어요')}</div>${listCandidatesSectionHtml}`;
    loadTalentSearchListCandidates(projectId);
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
    const badgeClass = manualLabel ? 'badge blue' : verdictBadgeClass(r.verdict);
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
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:10px;">
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
    ${listCandidatesSectionHtml}
  `;
  loadTalentSearchListCandidates(projectId);
}
```

아래로 교체(실제 후보 리스트 관련 부분을 전부 빼고, "← 뒤로"가 `openTalentSearchProjectFlow`로 가게 하고, 함수 이름도 용도에 맞게 남겨둔다 — 호출부는 Step 3에서 `openVirtualCandidatePreview`로 통일한다):

```js
function renderTalentSearchCandidatesScreen(projectId, project, candidates, policy, policyLoadError){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;

  const backBtn = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="openTalentSearchProjectFlow('${projectId}')">← 뒤로</button>`;

  if(!candidates.length){
    el.innerHTML = `
      ${backBtn}
      <div class="section">
        <div class="section-head"><div><h3>${escapeHtml(project.title)} — 가상 후보 미리보기</h3><div class="desc">아직 가상 후보를 생성하지 않았어요</div></div></div>
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
    const badgeClass = manualLabel ? 'badge blue' : verdictBadgeClass(r.verdict);
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
      <div class="section-head"><div><h3>${escapeHtml(project.title)} — 가상 후보 미리보기</h3><div class="desc">가상 시뮬레이션이라 다시 생성할 때마다 결과가 달라져요. 행을 클릭하면 상세와 수동 표시(정보 부족/중복)를 볼 수 있어요.</div></div></div>
      <div class="grid4">
        <div class="kpi"><div class="label">총 후보</div><div class="value">${results.length}명</div></div>
        <div class="kpi"><div class="label">추천</div><div class="value">${counts['추천']}명</div></div>
        <div class="kpi"><div class="label">확인 필요</div><div class="value">${counts['확인 필요']}명</div></div>
        <div class="kpi"><div class="label">제외</div><div class="value">${counts['제외']}명</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:10px;">
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

- [ ] **Step 3: `openTalentSearchCandidates`를 `openVirtualCandidatePreview`로 이름 변경 + 호출부 정리**

`openTalentSearchCandidates` 함수 — 현재 시작 부분:

```js
async function openTalentSearchCandidates(projectId){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="openTalentSearchProjectDetail('${projectId}')">← 뒤로</button><div style="color:var(--sub);font-size:13px;">불러오는 중...</div>`;
```

아래로 교체(함수명과 뒤로가기 대상만 변경):

```js
async function openVirtualCandidatePreview(projectId){
  const el = document.getElementById('talentsearch-projects');
  if(!el) return;
  el.innerHTML = `<button class="btn ghost sm" style="margin-bottom:14px;" onclick="openTalentSearchProjectFlow('${projectId}')">← 뒤로</button><div style="color:var(--sub);font-size:13px;">불러오는 중...</div>`;
```

같은 함수 안, 정책 로딩 조건 — 현재:

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

  renderTalentSearchCandidatesScreen(projectId, project, candidates, policy, policyLoadError);
}
```

아래로 교체(마지막 줄만 그대로, 함수 나머지는 안 바뀜 — 그냥 확인용으로 전체를 다시 씀):

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

  renderTalentSearchCandidatesScreen(projectId, project, candidates, policy, policyLoadError);
}
```

파일 전체에서 `openTalentSearchCandidates(` 호출부(정의부 제외) 나머지 2곳 — `regenerateTalentSearchCandidatesConfirm` 안의 `generateTalentSearchCandidates(projectId)` 호출과는 다른, `await openTalentSearchCandidates(projectId);` 형태로 된 곳들(`saveTalentSearchCandidateManualStatus`, `generateTalentSearchCandidates` 함수 끝부분 등) — 전부 `await openVirtualCandidatePreview(projectId);`로 교체한다. (`grep -n "openTalentSearchCandidates(" index.html`로 정의부 1곳 + 호출부 나머지를 확인하고 정의부를 뺀 전부를 바꾼다.)

- [ ] **Step 4: 로컬 dev 서버로 끝까지 수동 검증**

1. 대시보드에서 카드 클릭 → 새 5단계 세로 화면이 뜨는지 확인
2. `draft` 프로젝트: 1단계 블록에 "이 조건으로 검색" 버튼, 2~4단계는 흐리게 잠긴 상태로 보이는지
3. 승인 → 1단계 완료(✓)로 바뀌고 2단계가 활성화되는지, "연결 코드 확인" 링크를 누르면 설정 화면(다음 태스크에서 완성)으로 가는지
4. 실제 후보를 이미 가져온 프로젝트: 2단계 완료, 3단계에 진행률 바, 4단계에 기존 "실제 후보 리스트" 표(근거·직무60점·판정·더보기)가 정상적으로 뜨는지 — 이 표의 동작(정렬, 더보기, 이름 클릭)이 기존과 똑같이 되는지
5. "가상 후보로 미리 테스트해보기" 링크 클릭 → 가상 후보 화면(실제 후보 리스트 섹션 없이)이 뜨는지, "← 뒤로"를 누르면 방금 그 5단계 화면으로 돌아가는지
6. 가상 후보 화면에서 "다시 생성"·후보 클릭(수동 상태 지정) 등 기존 동작이 여전히 되는지, 그 뒤 다시 "뒤로"로 5단계 화면에 잘 돌아오는지

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: 프로젝트 상세를 5단계 세로 화면으로 통합

조건검토+검색진행+실제후보리스트 3개 화면을
openTalentSearchProjectFlow 하나로 합친다. 실제 후보 리스트 표는
기존 코드를 그대로 마운트만 옮긴다. 가상 후보 미리보기는
openVirtualCandidatePreview로 분리해서 보조 링크로 유지한다.
EOF
)"
```

---

### Task 5: `index.html` — 기준관리센터·버전이력·실행엔진연결을 별도 설정 진입점으로 분리

**Files:** Modify `index.html`

**Interfaces:**
- Consumes: `switchTalentSearchTab`(기존, 로직 무수정 — 진입 버튼 위치만 바뀜).

- [ ] **Step 1: 탭 바에서 대시보드 버튼을 없애고 "⚙ 설정" 버튼으로 교체**

`index.html`의 인재검색 뷰 안 탭 바 — 현재:

```html
      <div class="tabs">
        <button class="tab active" onclick="switchTalentSearchTab('dashboard')" id="tstab-dashboard">대시보드</button>
        <button class="tab" onclick="switchTalentSearchTab('policy')" id="tstab-policy">기준 관리센터</button>
        <button class="tab" onclick="switchTalentSearchTab('versions')" id="tstab-versions">버전 이력</button>
        <button class="tab" onclick="switchTalentSearchTab('connect')" id="tstab-connect">실행엔진 연결</button>
      </div>
```

아래로 교체(대시보드는 기본 화면이라 탭에서 빼고, 나머지 3개를 "설정" 드롭다운 하나로 묶는다):

```html
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <div style="position:relative;">
          <button class="btn ghost sm" onclick="toggleTsSettingsMenu()">⚙ 설정</button>
          <div id="ts-settings-menu" style="display:none;position:absolute;right:0;top:36px;background:var(--card);border:1px solid var(--border);border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.08);min-width:160px;z-index:10;">
            <button class="tab" style="width:100%;text-align:left;border-radius:0;" onclick="closeTsSettingsMenuAnd('policy')" id="tstab-policy">기준 관리센터</button>
            <button class="tab" style="width:100%;text-align:left;border-radius:0;" onclick="closeTsSettingsMenuAnd('versions')" id="tstab-versions">버전 이력</button>
            <button class="tab" style="width:100%;text-align:left;border-radius:0;" onclick="closeTsSettingsMenuAnd('connect')" id="tstab-connect">실행엔진 연결</button>
            <button class="tab" style="width:100%;text-align:left;border-radius:0;border-top:1px solid var(--border);" onclick="closeTsSettingsMenuAnd('dashboard')" id="tstab-dashboard-link">← 검색 프로젝트 목록으로</button>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: `switchTalentSearchTab`을 대시보드 기본 표시 + 설정메뉴 토글 함수와 함께 수정**

`switchTalentSearchTab` 함수 — 현재:

```js
function switchTalentSearchTab(tab){
  ['dashboard','policy','versions','connect'].forEach(t=>{
    document.getElementById('talentsearch-'+t).style.display = t===tab ? '' : 'none';
    document.getElementById('tstab-'+t).classList.toggle('active', t===tab);
  });
  if(tab==='dashboard') renderTalentSearchDashboard();
  if(tab==='policy') loadAndRenderTalentSearchPolicy();
  if(tab==='versions') loadAndRenderTalentSearchVersions();
  if(tab==='connect') loadAndRenderTalentSearchConnect();
}
```

아래로 교체(`tstab-dashboard`가 이제 없으므로 그 줄만 안전하게 건너뛰도록 `document.getElementById`가 `null`이어도 되게 옵셔널 체이닝 추가):

```js
function switchTalentSearchTab(tab){
  ['dashboard','policy','versions','connect'].forEach(t=>{
    const panel = document.getElementById('talentsearch-'+t);
    if(panel) panel.style.display = t===tab ? '' : 'none';
    document.getElementById('tstab-'+t)?.classList.toggle('active', t===tab);
  });
  if(tab==='dashboard') renderTalentSearchDashboard();
  if(tab==='policy') loadAndRenderTalentSearchPolicy();
  if(tab==='versions') loadAndRenderTalentSearchVersions();
  if(tab==='connect') loadAndRenderTalentSearchConnect();
}

function toggleTsSettingsMenu(){
  const menu = document.getElementById('ts-settings-menu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function closeTsSettingsMenuAnd(tab){
  document.getElementById('ts-settings-menu').style.display = 'none';
  switchTalentSearchTab(tab);
}
```

- [ ] **Step 3: 로컬 dev 서버로 수동 검증**

1. "인재검색" 메뉴 클릭 → 탭 없이 바로 프로젝트 카드 목록이 보이는지 확인
2. 우측 상단 "⚙ 설정" 클릭 → 드롭다운에 3개 메뉴가 뜨는지, 각각 누르면 해당 화면(기준 관리센터/버전 이력/실행엔진 연결)이 열리는지, 열린 뒤 "뒤로 가기"(그 화면 내부의 기존 뒤로가기가 있다면) 또는 "인재검색" 메뉴를 다시 눌러서 대시보드로 돌아오는지 확인
3. 설정 화면들 자체의 기존 기능(정책 카드 수정, 초안 적용, 버전 복구, 연결 코드 발급)이 여전히 정상 동작하는지 회귀 확인

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
feat: 기준관리센터·버전이력·실행엔진연결을 별도 설정 메뉴로 분리

인재검색 메뉴를 누르면 탭 없이 바로 프로젝트 카드 목록이 보이고,
공용 설정 3개는 우측 상단 "⚙ 설정" 드롭다운으로 옮긴다.
EOF
)"
```

---

## Self-Review

**스펙 커버리지**: role_title 제약 완화(Task1), 폼 필드 정리+용도 라벨(Task2), 단계 계산+대시보드 배지(Task3), 5단계 통합 화면+가상후보 분리(Task4), 설정 메뉴 분리(Task5) — 스펙의 모든 섹션이 매핑된다. "다른 플랫폼 확장 대비" 절은 Task3(플랫폼 이름 미하드코딩)과 Task4(플랫폼별 줄 표시)에 반영됨.

**플레이스홀더 스캔**: 없음.

**타입/시그니처 일관성**: `computeTalentSearchProjectStage(project, listCandidates, policy)` → `{stage, recommendedCount}` — Task3 정의, Task4(`openTalentSearchProjectFlow`) 소비 동일. `openTalentSearchProjectFlow(id)` — Task3의 카드 onclick과 Task4의 정의·"뒤로가기" 대상 전부 동일한 이름. `openVirtualCandidatePreview(projectId)` — Task4에서 정의하고 그 안의 모든 호출부를 같은 이름으로 통일.

## 실행 순서

Task 1 → Task 2 → Task 3(선행 조건: 사람인 검색 실행 자동화 계획의 Task 1) → Task 4 → Task 5. Task 3과 Task 4는 강하게 연결돼 있어(카드 클릭이 Task4의 함수를 가리킴) 순서를 지키는 게 중요하다. Task 5는 다른 태스크와 독립적이라 마지막에 몰아서 해도 되고 먼저 해도 무방하다.
