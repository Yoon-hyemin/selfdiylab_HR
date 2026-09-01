# 인재검색 사람인 검색 실행 자동화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 크롬 확장의 "목표 인원 채우기"가 페이지 넘기기를 시작하기 전에, 먼저 사람인 검색창(OR/AND/NOT)에 프로젝트의 키워드 조건을 채우고 검색을 실행한다.

**Architecture:** 서버는 이미 있는 `keywords` 컬럼을 확장이 쓰는 프로젝트 목록 응답에 노출하기만 한다(신규 컬럼·마이그레이션 없음). 확장은 새 순수 함수(입력값 채우기, 검색창/버튼 탐색)를 `list-content-lib.js`에 추가하고, 새 메시지 타입 `FILL_AND_SEARCH`를 `list-content.js`에 추가한 뒤, `popup.js`가 기존 페이지 넘기기 루프 시작 전에 이 메시지를 한 번 보내도록 통합한다. 안전장치(무작위 지연, 인증화면 감지)는 새로 안 만들고 페이지 넘기기 때 쓰던 것을 그대로 재사용한다.

**Tech Stack:** Node.js ESM 서버리스 핸들러, Manifest V3 크롬 확장(Vanilla JS), `node --test`(jsdom).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-28-talent-search-auto-search-execution-design.md`.
- 사람인 한 플랫폼만. 잡코리아/원티드/리멤버는 범위 밖.
- 필수조건(`keywords.include`)+정확일치(`keywords.exact`, 따옴표로 감쌈)는 AND칸, 핵심조건(`keywords.or`)은 OR칸, 제외조건(`keywords.exclude`)은 NOT칸. 우대조건(`keywords.preferred`)은 검색어로 쓰지 않는다.
- **사람인 검색창의 실제 DOM 선택자는 아직 확인되지 않았다.** 이 프로젝트가 반복해온 패턴(카드 선택자 `.talent_list_item`, 페이지네이션 버튼 `.PageBox .BtnNext`도 처음엔 추정치로 구현하고 실제 로그인 화면에서 확정)을 그대로 따른다 — 이번 계획의 관련 태스크에도 "구현 시점에 실제 로그인 세션에서 라이브 DOM을 확인하고, 다르면 선택자와 테스트 fixture만 교체(함수 시그니처는 유지)"를 명시해뒀다.
- 안전장치는 기존 `isBlockedPage`, `randomPageDelayMs()`를 그대로 재사용 — 새로 만들지 않는다.
- 새 마이그레이션 없음(`keywords` 컬럼은 `sql/017`에 이미 있음).
- 커밋 메시지는 한국어.

---

### Task 1: 서버 — 프로젝트 목록 응답에 keywords 노출

**Files:** Modify `handlers/talent-search-projects/index.js`

**Interfaces:**
- Produces: `GET /api/talent-search-projects`(연결 코드 인증 포함, 기존 엔드포인트) 응답의 각 프로젝트 객체에 `keywords: {include, or, exact, exclude, preferred}` 필드 추가. Task 3(팝업)이 이 필드를 그대로 소비한다.

- [ ] **Step 1: SELECT 쿼리에 keywords 추가**

`handlers/talent-search-projects/index.js`의 GET 핸들러 안 SELECT 쿼리 — 현재:

```js
      const rows = await sql`
        SELECT id, title, role_title, seniority_level, employment_type, headcount,
               location, target_recommend_count, daily_recommend_cap, platforms,
               status, policy_version_id, created_at
        FROM talent_search_projects
        ORDER BY created_at DESC`;
```

아래로 교체:

```js
      const rows = await sql`
        SELECT id, title, role_title, seniority_level, employment_type, headcount,
               location, target_recommend_count, daily_recommend_cap, platforms,
               status, policy_version_id, keywords, created_at
        FROM talent_search_projects
        ORDER BY created_at DESC`;
```

- [ ] **Step 2: `project_summary_out`에 keywords 매핑 추가**

같은 파일의 `project_summary_out` 함수 — 현재:

```js
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
    policyVersionId: row.policy_version_id,
    createdAt: row.created_at
  };
}
```

아래로 교체(`keywords: row.keywords` 한 줄 추가):

```js
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
    policyVersionId: row.policy_version_id,
    keywords: row.keywords,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 3: 로컬 dev 서버로 수동 검증**

1. `.env.local`이 `development` 브랜치를 가리키는지 확인, dev 서버 실행 확인
2. 로그인된 브라우저 콘솔 또는 연결 코드로: `fetch('/api/talent-search-projects', {headers:{Authorization:'Bearer <연결코드>'}}).then(r=>r.json()).then(console.log)` — 각 프로젝트 객체에 `keywords` 필드가 `{include:[...], or:[...], exact:[...], exclude:[...], preferred:[...]}` 형태로 포함되는지 확인
3. HR 사이트 화면(쿠키세션, "인재검색 → 대시보드")도 여전히 정상 동작하는지 회귀 확인(이 필드가 추가돼도 그 화면은 안 쓰므로 영향 없어야 함)

- [ ] **Step 4: 커밋**

```bash
git add handlers/talent-search-projects/index.js
git commit -m "$(cat <<'EOF'
feat: 검색 프로젝트 목록 응답에 keywords 필드 노출

크롬 확장이 검색 실행 자동화(다음 태스크)에서 프로젝트의 키워드
조건을 읽어야 해서, 이미 있는 컬럼을 목록 응답에도 포함시킨다.
EOF
)"
```

---

### Task 2: 크롬 확장 — 검색창 채우기 순수함수 + FILL_AND_SEARCH 메시지

**Files:**
- Modify: `chrome-extension/list-content-lib.js`
- Modify: `chrome-extension/list-content-lib.test.js`
- Modify: `chrome-extension/list-content.js`

**Interfaces:**
- Produces: `list-content-lib.js`에 세 함수 추가 —
  - `setNativeInputValue(inputEl, text)`: 네이티브 value setter로 값을 설정하고 `input` 이벤트를 발생시킴(반환값 없음).
  - `findSearchInputs(doc)`: `{or: Element|null, and: Element|null, not: Element|null}` 반환.
  - `findSearchButton(doc)`: 검색 버튼 `Element` 또는 `null` 반환.
  `list-content.js`가 새 메시지 타입 `FILL_AND_SEARCH`(payload `{andTerms, orTerms, notTerms}`, 각각 문자열)에 응답해 `{ok: boolean, blocked: boolean, skipped: boolean}`을 돌려준다 — Task 3(팝업)이 이 메시지 계약을 그대로 쓴다.

- [ ] **Step 1: 실제 사람인 검색창의 DOM을 먼저 확인한다**

이 스텝의 코드는 실사용 확인 전 합리적인 추정이다 — `.talent_list_item`, `.PageBox .BtnNext`를 확정했을 때와 같은 방식으로, 실제 화면 구조와 다르면 이 스텝의 선택자만 고치고 함수 시그니처(인자/반환값 모양)는 유지한다. 로그인해서 실제 검색 화면 상단의 OR/AND/NOT 3칸 입력과 "검색" 버튼을 개발자도구로 확인하고, 각각의 정확한 선택자(placeholder, name 속성, class 등)를 기록한다.

- [ ] **Step 2: `setNativeInputValue`/`findSearchInputs`/`findSearchButton` 작성 (실제 확인한 선택자로 교체)**

`chrome-extension/list-content-lib.js` 맨 아래에 추가:

```js
// 네이티브 input의 값 설정자를 통해 값을 바꾼 뒤 input 이벤트를
// 발생시킨다. React 등 프레임워크로 만들어진 입력창은 `el.value = x`만
// 으로는 내부 상태가 갱신되지 않는 경우가 흔해서(화면엔 값이 보여도
// 검색 버튼을 눌렀을 때 실제로는 반영이 안 됨), 반드시 이 방식으로
// 값을 채워야 한다. `inputEl.ownerDocument.defaultView`로 window를
// 구해서 jsdom 테스트와 실제 콘텐츠 스크립트 양쪽에서 동일하게
// 동작하게 한다(콘텐츠 스크립트에서 그냥 전역 window를 참조하면 jsdom
// 테스트 환경에서는 window가 없어 에러가 난다).
export function setNativeInputValue(inputEl, text) {
  const win = inputEl.ownerDocument.defaultView;
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
  setter.call(inputEl, text);
  inputEl.dispatchEvent(new win.Event('input', { bubbles: true }));
}

// 사람인 검색창의 OR/AND/NOT 3칸을 찾는다. 선택자는 2026-08-28 시점
// 미검증 추정치 -- placeholder 텍스트로 우선 찾고, 없으면 name 속성
// 폴백을 시도한다. 못 찾으면 해당 키는 null이 된다(추측해서 엉뚱한
// input에 값을 넣지 않는다 -- 이 프로젝트의 fail-closed 원칙).
export function findSearchInputs(doc) {
  const byPlaceholder = (text) =>
    Array.from(doc.querySelectorAll('input')).find(el => (el.placeholder || '').includes(text)) || null;
  return {
    or: byPlaceholder('하나 이상의 키워드') || doc.querySelector('input[name="or_word"]'),
    and: byPlaceholder('키워드를 모두 포함') || doc.querySelector('input[name="and_word"]'),
    not: byPlaceholder('제외할 키워드') || doc.querySelector('input[name="not_word"]')
  };
}

// 검색 버튼을 찾는다. 텍스트가 정확히 "검색"인 button 요소를 찾는다.
export function findSearchButton(doc) {
  return Array.from(doc.querySelectorAll('button')).find(el => (el.textContent || '').trim() === '검색') || null;
}
```

- [ ] **Step 3: 테스트 작성 (jsdom)**

`chrome-extension/list-content-lib.test.js`의 기존 import 줄을 아래로 교체:

```js
import { parseCandidateCard, findNextPageButton, setNativeInputValue, findSearchInputs, findSearchButton } from './list-content-lib.js';
```

파일 맨 아래에 추가:

```js
test('setNativeInputValue: 값을 설정하고 input 이벤트를 발생시킨다', () => {
  const dom = new JSDOM('<input>');
  const input = dom.window.document.querySelector('input');
  let firedValue = null;
  input.addEventListener('input', () => { firedValue = input.value; });
  setNativeInputValue(input, '영상편집');
  assert.equal(input.value, '영상편집');
  assert.equal(firedValue, '영상편집');
});

test('findSearchInputs: placeholder로 OR/AND/NOT 3칸을 찾는다', () => {
  const dom = new JSDOM(`
    <div>
      <input placeholder="하나 이상의 키워드 포함">
      <input placeholder="키워드를 모두 포함">
      <input placeholder="제외할 키워드">
    </div>
  `);
  const inputs = findSearchInputs(dom.window.document);
  assert.equal(inputs.or.placeholder, '하나 이상의 키워드 포함');
  assert.equal(inputs.and.placeholder, '키워드를 모두 포함');
  assert.equal(inputs.not.placeholder, '제외할 키워드');
});

test('findSearchInputs: 못 찾으면 null', () => {
  const dom = new JSDOM('<div></div>');
  const inputs = findSearchInputs(dom.window.document);
  assert.equal(inputs.or, null);
  assert.equal(inputs.and, null);
  assert.equal(inputs.not, null);
});

test('findSearchButton: 텍스트가 정확히 "검색"인 버튼을 찾는다', () => {
  const dom = new JSDOM('<div><button>필터 초기화</button><button>검색</button></div>');
  const btn = findSearchButton(dom.window.document);
  assert.equal(btn.textContent, '검색');
});

test('findSearchButton: 없으면 null', () => {
  const dom = new JSDOM('<div><button>다른 버튼</button></div>');
  assert.equal(findSearchButton(dom.window.document), null);
});
```

- [ ] **Step 4: 테스트 실행**

Run: `node --test chrome-extension/list-content-lib.test.js`
Expected: 기존 테스트 포함 모두 PASS(신규 5개 추가)

(주의: Step 1에서 확인한 실제 선택자가 Step 2의 추정과 다르면, Step 2의 구현과 이 테스트의 fixture HTML을 실제 선택자에 맞게 같이 고친다.)

- [ ] **Step 5: `list-content.js`에 `FILL_AND_SEARCH` 핸들러 추가**

`chrome-extension/list-content.js`의 `chrome.runtime.onMessage.addListener(...)` 안, `CLICK_NEXT_PAGE` 분기(`if (message.type === 'CLICK_NEXT_PAGE') { ... }`) 바로 뒤, 마지막 `return false;` 앞에 추가:

```js
  if (message.type === 'FILL_AND_SEARCH') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        sendResponse({ ok: false, blocked: true, skipped: false });
        return;
      }

      const { andTerms, orTerms, notTerms } = message;
      // 셋 다 비어있으면(프로젝트에 키워드가 하나도 없음) 검색창을
      // 건드리지 않고 건너뛴다 -- 빈 조건으로 검색 버튼을 눌러서 이미
      // 사용자가 사람인에서 설정해 둔 화면을 예상 못한 상태로 바꾸지
      // 않기 위해서다.
      if (!andTerms && !orTerms && !notTerms) {
        sendResponse({ ok: true, blocked: false, skipped: true });
        return;
      }

      const { setNativeInputValue, findSearchInputs, findSearchButton } = await getLib();
      const inputs = findSearchInputs(document);
      if (inputs.and && andTerms) setNativeInputValue(inputs.and, andTerms);
      if (inputs.or && orTerms) setNativeInputValue(inputs.or, orTerms);
      if (inputs.not && notTerms) setNativeInputValue(inputs.not, notTerms);

      const searchBtn = findSearchButton(document);
      if (!searchBtn) {
        sendResponse({ ok: false, blocked: false, skipped: false });
        return;
      }
      searchBtn.click();
      sendResponse({ ok: true, blocked: false, skipped: false });
    })();
    return true;
  }

```

- [ ] **Step 6: 커밋**

```bash
git add chrome-extension/list-content-lib.js chrome-extension/list-content-lib.test.js chrome-extension/list-content.js
git commit -m "$(cat <<'EOF'
feat: 크롬 확장에 사람인 검색창 자동채우기+검색실행(FILL_AND_SEARCH) 추가

setNativeInputValue/findSearchInputs/findSearchButton 순수함수와
콘텐츠 스크립트 메시지 핸들러 신설. 키워드가 하나도 없으면 검색
버튼을 누르지 않고 건너뛴다. 반복 여부·지연은 팝업이 주도한다.
EOF
)"
```

---

### Task 3: 크롬 확장 — 팝업이 페이지 넘기기 전에 검색 실행

**Files:** Modify `chrome-extension/popup.js`

**Interfaces:**
- Consumes: `GET /api/talent-search-projects` 응답의 `keywords` 필드(Task 1), `FILL_AND_SEARCH` 메시지의 `{ok, blocked, skipped}` 응답(Task 2).

- [ ] **Step 1: 프로젝트 목록을 캐싱하도록 변경**

`chrome-extension/popup.js`에서 `const listImportSection = ...` 아래 상수 선언 줄 바로 다음에 추가:

```js
let cachedApprovedProjects = [];
```

같은 파일의 `initListImportUiIfApplicable` 함수 안 — 현재:

```js
    const approvedProjects = data.projects.filter(p => p.status === 'approved');
    if (!approvedProjects.length) {
      importStatus.textContent = '승인된 검색 프로젝트가 없어요 - 먼저 HR 사이트에서 프로젝트를 승인해주세요';
      projectSelect.replaceChildren();
      return;
    }
```

아래로 교체(마지막 줄에 캐싱 추가):

```js
    const approvedProjects = data.projects.filter(p => p.status === 'approved');
    cachedApprovedProjects = approvedProjects;
    if (!approvedProjects.length) {
      importStatus.textContent = '승인된 검색 프로젝트가 없어요 - 먼저 HR 사이트에서 프로젝트를 승인해주세요';
      projectSelect.replaceChildren();
      return;
    }
```

- [ ] **Step 2: 프로젝트 keywords로 AND/OR/NOT 문자열을 만드는 헬퍼 추가**

`randomPageDelayMs`/`wait` 함수 정의 바로 뒤에 추가:

```js
// 프로젝트의 keywords(포함/OR/정확일치/제외/우대)를 사람인 검색창의
// 3칸(OR/AND/NOT)에 맞춰 문자열로 변환한다. 정확일치는 따옴표로
// 감싸 AND칸에 같이 넣는다(사람인이 실제로 따옴표를 정확일치로
// 처리하는지는 라이브 검증 대상 -- 안 되더라도 AND 조건으로는
// 동작하니 크게 어긋나지 않는다). 우대조건은 검색어로 쓰지 않는다
// (사람인 검색창에 대응하는 칸이 없고, 채점에서만 신호로 씀).
function buildSearchTerms(keywords) {
  const kw = keywords || {};
  const andTerms = [...(kw.include || []), ...(kw.exact || []).map(k => `"${k}"`)].join(' ');
  const orTerms = (kw.or || []).join(' ');
  const notTerms = (kw.exclude || []).join(' ');
  return { andTerms, orTerms, notTerms };
}
```

- [ ] **Step 3: `importBtn` 클릭 핸들러에 검색 실행 단계 추가**

현재 `try` 블록의 시작 부분(`// eslint-disable-next-line no-constant-condition` / `while (true) {` 로 시작하는 줄) 바로 앞에 아래 코드를 삽입하고, 기존 `while (true) { ... }` 루프 전체를 `else` 블록으로 감싼다. 즉, 현재:

```js
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      pageCount += 1;
      importStatus.textContent = `${pageCount}페이지째 가져오는 중... (지금까지 ${totalImported}명 확보)`;

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const parseResult = await chrome.tabs.sendMessage(tab.id, { type: 'PARSE_CURRENT_LIST' });
```

부터 그 루프가 끝나는

```js
      await wait(randomPageDelayMs());
    }

    if (totalImported === 0 && totalSkipped === 0) {
```

직전까지를 아래로 교체(루프 앞에 검색 실행 단계 추가, 루프 전체를 `if(searchOk)` 블록으로 감쌈 — 루프 안쪽 내용 자체는 한 글자도 안 바뀐다):

```js
  try {
    const selectedProject = cachedApprovedProjects.find(p => p.id === projectId);
    const { andTerms, orTerms, notTerms } = buildSearchTerms(selectedProject && selectedProject.keywords);

    importStatus.textContent = '검색 조건 채우는 중...';
    const [searchTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const searchResult = await chrome.tabs.sendMessage(searchTab.id, {
      type: 'FILL_AND_SEARCH', andTerms, orTerms, notTerms
    });

    let searchOk = false;
    if (searchResult && searchResult.blocked) {
      stopReason = '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요';
    } else if (!searchResult || !searchResult.ok) {
      stopReason = '검색 조건을 채우지 못했어요 - 사람인 화면 구조가 바뀌었을 수 있어요';
    } else {
      searchOk = true;
      if (!searchResult.skipped) await wait(randomPageDelayMs());
    }

    if (searchOk) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        pageCount += 1;
        importStatus.textContent = `${pageCount}페이지째 가져오는 중... (지금까지 ${totalImported}명 확보)`;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const parseResult = await chrome.tabs.sendMessage(tab.id, { type: 'PARSE_CURRENT_LIST' });
        if (parseResult && parseResult.blocked) {
          stopReason = '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요';
          break;
        }

        const allCandidates = (parseResult && parseResult.candidates) || [];
        const newCandidates = allCandidates.filter(c => c.sourceUrl && !seenUrls.has(c.sourceUrl));
        if (!newCandidates.length) {
          stopReason = pageCount === 1 ? '가져올 후보를 찾지 못했어요' : '더 이상 새로운 후보가 없어요';
          break;
        }
        newCandidates.forEach(c => seenUrls.add(c.sourceUrl));

        const res = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects/${projectId}/list-candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ platform: '사람인', candidates: newCandidates })
        });
        const data = await res.json();
        if (!res.ok) {
          stopReason = data.error || '가져오기 실패';
          break;
        }

        totalImported += data.imported;
        totalSkipped += data.skipped || 0;

        if (totalImported >= target) break;

        if (pageCount >= MAX_PAGES) {
          stopReason = `안전 상한(${MAX_PAGES}페이지)에 도달해 멈췄어요. 필요하면 사람인에서 직접 다음 페이지로 이동한 뒤 다시 눌러주세요.`;
          break;
        }

        const nextResult = await chrome.tabs.sendMessage(tab.id, { type: 'CLICK_NEXT_PAGE' });
        if (!nextResult || nextResult.blocked) {
          stopReason = '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요';
          break;
        }
        if (!nextResult.hasNextPage) {
          stopReason = '마지막 페이지예요';
          break;
        }

        await wait(randomPageDelayMs());
      }
    }

    if (totalImported === 0 && totalSkipped === 0) {
```

(이 지점부터 파일 끝의 `});`까지는 기존 코드 그대로 안 바뀐다 — `catch`/`finally` 블록도 그대로 둔다.)

- [ ] **Step 4: 실제 크롬에서 끝까지 검증 (컨트롤러가 사용자와 함께 직접 진행)**

서브에이전트는 브라우저 접근이 없으므로 이 스텝은 반드시 실제 크롬 확장을 리로드해서 진행한다.

1. `chrome://extensions`에서 확장 리로드
2. 사람인 검색 화면(검색 전이든, 이미 다른 검색을 해둔 상태든 상관없음)을 연다
3. 키워드가 등록된 승인된 프로젝트를 선택하고 "목표 인원 채우기" 클릭
4. 상태 메시지가 "검색 조건 채우는 중..."으로 바뀌는지, 실제로 검색창 3칸에 그 프로젝트의 키워드가 채워지는지, 검색 버튼이 눌려서 결과가 그 조건으로 바뀌는지 눈으로 확인
5. 그 뒤 기존처럼 페이지 넘기기+가져오기가 이어지는지 확인
6. 키워드를 하나도 등록 안 한 프로젝트로도 시도해서, 검색창을 안 건드리고 지금 화면 그대로 가져오기를 시작하는지 확인
7. HR 사이트의 "검색 진행 → 실제 후보 리스트"에서 실제로 그 조건에 맞는 후보들이 들어왔는지 확인
8. 검증에 쓴 테스트 데이터 정리

- [ ] **Step 5: 커밋**

```bash
git add chrome-extension/popup.js
git commit -m "$(cat <<'EOF'
feat: 목표인원 채우기가 페이지 넘기기 전에 사람인 검색을 먼저 실행

프로젝트의 keywords를 AND/OR/NOT 문자열로 변환해 FILL_AND_SEARCH로
전달, 검색 실행 성공 시에만 기존 페이지 넘기기 루프로 진입한다.
EOF
)"
```

---

## Self-Review

**스펙 커버리지**: keywords 노출(Task1), 검색창 채우기+검색버튼 순수함수+메시지 핸들러(Task2), 팝업 통합(안전장치 재사용 포함)(Task3) — 스펙의 모든 섹션이 매핑된다. 잡코리아/원티드/리멤버, 검색어 자동생성/동의어 확장, 사이드바 다른 필터는 스펙에서도 명시적 범위 밖이라 태스크 없음(의도됨).

**플레이스홀더 스캔**: 없음. 검색창 선택자는 명시적으로 "실사용 확인 전 추정치, 실제 확인 후 교체" 절차로 표시됨(기존 카드/페이지네이션 선택자 확정 때와 동일한 절차).

**타입/시그니처 일관성**: `FILL_AND_SEARCH` 요청 `{andTerms, orTerms, notTerms}` — Task3이 만들어 보내고 Task2가 그대로 받음. 응답 `{ok, blocked, skipped}` — Task2가 만들고 Task3이 그대로 소비. `setNativeInputValue(inputEl, text)`/`findSearchInputs(doc)`/`findSearchButton(doc)` — Task2 정의·테스트·소비 동일.

## 실행 순서

Task 1 → Task 2 → Task 3(서버 필드가 있어야 팝업이 keywords를 읽을 수 있고, 메시지 핸들러가 있어야 팝업이 호출할 수 있으므로 순서대로 진행). Task 3의 라이브 검증은 컨트롤러+사용자가 함께.
