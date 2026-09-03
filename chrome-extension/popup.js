// chrome-extension/popup.js
const HR_SITE_ORIGIN = 'https://selfdiylab-hr.vercel.app'; // 2026-09-02: 실사용을 위해 배포된 프로덕션 주소로 변경.

const tokenInput = document.getElementById('tokenInput');
const tokenSaveBtn = document.getElementById('tokenSaveBtn');
const tokenStatus = document.getElementById('tokenStatus');

async function loadSavedToken() {
  const { extensionToken } = await chrome.storage.local.get('extensionToken');
  return extensionToken || null;
}

tokenSaveBtn.addEventListener('click', async () => {
  const value = tokenInput.value.trim();
  if (!value) return;
  await chrome.storage.local.set({ extensionToken: value });
  tokenInput.value = '';
  tokenStatus.textContent = '저장됨';
  await initListImportUiIfApplicable();
});

const listImportSection = document.getElementById('listImportSection');
const projectSelect = document.getElementById('projectSelect');
const targetCountInput = document.getElementById('targetCountInput');
const importBtn = document.getElementById('importBtn');
const importStatus = document.getElementById('importStatus');

let cachedApprovedProjects = [];

async function initListImportUiIfApplicable() {
  const token = await loadSavedToken();
  tokenStatus.textContent = token ? '연결 코드 저장됨' : '연결 코드를 입력해주세요';
  if (!token) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isListPage = tab.url && tab.url.includes('/zf_user/memcom/talent-pool/');
  if (!isListPage) return;

  listImportSection.style.display = '';
  try {
    const res = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) {
      importStatus.textContent = data.error || '프로젝트 목록을 불러오지 못했어요';
      return;
    }
    // status==='approved'만 골라서 보여준다 -- "검색 진행" 화면(이 리스트
    // 후보가 표시되는 곳)은 승인된 프로젝트에서만 열리므로(index.html의
    // 'p.status===approved' 가드), draft 프로젝트에 가져오면 저장은
    // 성공하지만 그 데이터를 다시 볼 방법이 없는 상태가 된다.
    const approvedProjects = data.projects.filter(p => p.status === 'approved');
    cachedApprovedProjects = approvedProjects;
    if (!approvedProjects.length) {
      importStatus.textContent = '승인된 검색 프로젝트가 없어요 - 먼저 HR 사이트에서 프로젝트를 승인해주세요';
      projectSelect.replaceChildren();
      return;
    }
    // innerHTML 문자열 보간 대신 DOM 노드를 직접 만든다 -- p.title은
    // HR 사이트에서 자유 입력된 텍스트라, 문자열로 조립하면 그 값 안의
    // 따옴표/꺾쇠로 마크업이 깨지거나 스크립트가 주입될 수 있다.
    projectSelect.replaceChildren(...approvedProjects.map(p => new Option(p.title, p.id)));
  } catch (err) {
    importStatus.textContent = `프로젝트 목록 오류: ${err.message}`;
  }
}

// 한 번의 "가져오기" 클릭이 넘길 수 있는 최대 페이지 수. 무한정
// 페이지를 넘기지 않도록 하는 안전장치이지 정책값이 아니라서 상수로만
// 관리한다(설계문서 참고) -- 더 필요하면 사람인에서 수동으로 몇 페이지
// 넘긴 뒤 다시 누르면 된다. 2026-09-02: 사용자 확인 후 5 -> 30으로
// 상향(라이브 실행에서 로그인/인증 화면 없이 정상 동작 확인됨).
const MAX_PAGES = 30;

// 검색 버튼을 누른 뒤 결과가 실제로 갱신됐는지 확인하는 재시도 횟수.
// randomPageDelayMs()는 사람처럼 보이기 위한 지연일 뿐 페이지가 실제로
// 갱신됐다는 신호가 아니라서, 느린 네비게이션/AJAX 갱신이 그 지연
// 창(2.5~4.5초) 이후에 끝나면 옛날(검색 전) 결과를 그대로 가져올 위험이
// 있다 -- 그래서 첫 후보의 sourceUrl이 바뀔 때까지 최대 이 횟수만큼
// PARSE_CURRENT_LIST로 다시 확인한다. 무한정 기다리지는 않는다(다
// 확인해도 안 바뀌면 그냥 진행 -- 검색 전후 결과가 우연히 같은 것도
// 정상적인 경우이지 실패로 볼 수 없다).
const MAX_READINESS_POLL_ATTEMPTS = 5;

function randomPageDelayMs() {
  // 페이지 이동마다 정확히 같은 간격으로 클릭하지 않도록 2.5~4.5초
  // 사이 무작위 지연을 둔다(사람처럼 보이게 하는 안전장치 -- 실행엔진
  // OCR 작업 중 실제로 2단계인증을 겪은 적이 있어서 도입).
  return 2500 + Math.random() * 2000;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 프로젝트의 keywords(포함/OR/정확일치/제외/우대)를 사람인 검색창의
// 3칸(OR/AND/NOT)에 맞춰 "칩으로 하나씩 커밋할 키워드 배열"로
// 변환한다. 2026-09-02 실사용 확인 전까지는 이걸 공백으로 이어붙인
// 문자열 하나로 만들어서 한 번에 넣으면 되는 줄 알았는데, 실제로는
// 각 칸이 "입력 후 Enter로 확정되는 칩 태그" 방식이라 키워드 하나당
// Enter 한 번씩 필요하다는 게 밝혀져서 배열로 바꿨다(아래
// fillAndSearch 참고). 정확일치는 따옴표로 감싸 AND칸에 같이 넣는다.
// 우대조건은 검색어로 쓰지 않는다(사람인 검색창에 대응하는 칸이
// 없고, 채점에서만 신호로 씀).
function buildSearchTerms(keywords) {
  const kw = keywords || {};
  const andTerms = [...(kw.include || []), ...(kw.exact || []).map(k => `"${k}"`)];
  const orTerms = kw.or || [];
  const notTerms = kw.exclude || [];
  return { andTerms, orTerms, notTerms };
}

// 칩 하나를 커밋하는 "진짜" Enter 키 입력을 보낸다. 콘텐츠 스크립트의
// dispatchEvent(new KeyboardEvent(...))는 isTrusted=false라서 사람인
// 검색창이 무시한다는 것을 실사용 확인 중 발견했다(값은 채워지지만
// 실제 검색 요청에는 전혀 반영 안 됨) -- chrome.debugger의
// Input.dispatchKeyEvent는 브라우저 입력 파이프라인을 거치는 "진짜"
// 입력이라 이 사이트가 실제 사용자 입력으로 인정한다(라이브 확인:
// 이 방식으로 누른 Enter 뒤에는 검색 결과가 실제로 바뀜). 포커스는
// 이 함수가 아니라 호출 직전 FILL_SEARCH_TERM이 이미 맞춰둔
// input에 그대로 적용된다(키보드 이벤트는 좌표가 아니라 지금
// 포커스된 요소를 대상으로 하므로).
// 2026-09-03 추가: 키워드 글자 자체를 "진짜" 입력으로 넣는다.
// FILL_SEARCH_TERM(콘텐츠 스크립트)이 네이티브 setter로 값을 채우던
// 이전 방식은 화면엔 정상 표시되지만, 사람인 검색창이 React 계열
// controlled input이라 실제 내부 상태는 'input' 이벤트로만 갱신된다는
// 게 라이브 진단으로 드러났다 -- keyup/change만으로는 내부 상태가
// 안 바뀌어서, 그 뒤 아무리 진짜 Enter를 보내도 "입력된 게 없다"고
// 판단해 칩이 안 만들어졌다(콘솔엔 매 단계 성공으로 찍히는데 실제
// DOM엔 커밋된 칩이 하나도 없던 증상의 원인). CDP의 Input.insertText는
// 실제 사용자가 타이핑한 것과 동일한 신뢰 경로로 텍스트를 삽입해서
// (한글 조합 입력도 이 방식이 표준) 이 문제를 피한다 -- 사람처럼 한
// 글자씩 실제 typing으로 넣었을 때는 Enter로 칩이 정상 생성되는 것을
// 별도 라이브 테스트로 먼저 확인한 뒤 이 함수를 추가했다.
async function dispatchTrustedText(tabId, text) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

async function dispatchTrustedEnter(tabId) {
  // 2026-09-02: 모든 단계가 "성공"으로 찍히는데도 실제로는 칩이 안
  // 생기는 문제 진단 중 발견 -- CDP 표준 라이브러리(Puppeteer)가 실제로
  // 쓰는 Enter 페이로드를 그대로 맞췄다. 이전엔 type:'rawKeyDown'에
  // text 필드가 없어서 크롬이 "이 키가 문자를 만들어내는 키"라고 인식
  // 못했을 가능성이 있다 -- text/unmodifiedText가 있으면 type을
  // 'keyDown'으로 보내야 크롬이 그에 맞는 후속 처리(문자 입력 이벤트
  // 생성 등)까지 같이 해준다.
  const params = {
    type: 'keyDown', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
    code: 'Enter', key: 'Enter', text: '\r', unmodifiedText: '\r'
  };
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', params);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { ...params, type: 'keyUp' });
}

// 칩 커밋 사이 짧은 대기 -- 페이지 넘김 때 쓰는 randomPageDelayMs()
// (2.5~4.5초, 사람처럼 보이기 위한 지연)와는 목적이 다르다. 이건
// 그냥 이번 칩이 화면에 반영될 시간을 주는 것뿐이라 짧게 잡는다.
const CHIP_COMMIT_DELAY_MS = 400;

// 2026-09-02: 사용자가 확정한 고정 기본값 -- 프로젝트별로 다르게
// 설정하는 게 아니라 "목표 인원 채우기"를 누를 때마다 항상 이렇게
// 적용한다. 이유: 업데이트가 너무 오래된 후보는 지금 이직 생각이
// 없을 가능성이 높아서, 추천순 대신 최근 업데이트순으로 보고 싶고
// (지금 활발히 움직이는 사람 우선), 6개월 넘게 업데이트 없는 후보는
// 아예 검색 결과에서 빼고 싶다는 요청.
const DEFAULT_UPDATE_FRESHNESS_VALUE = '6month';
const DEFAULT_SORT_LABEL = '업데이트일순';

// 검색창에 프로젝트의 keywords를 채우고 검색을 실행한다.
// {ok, blocked, missing, firstCandidateIdBefore} 형태로 결과를 돌려준다
// (기존 FILL_AND_SEARCH 메시지의 응답 모양과 호환되게 맞췄다 --
// 호출부인 importBtn 핸들러의 이후 로직은 그대로 재사용).
// 키워드가 하나도 없으면(andTerms/orTerms/notTerms 전부 빈 배열)
// chrome.debugger를 붙이지도 않고 즉시 skipped:true로 돌아간다 --
// 이미 사람인에 설정해 둔 화면을 예상 못하게 바꾸지 않기 위해서다.
async function fillAndSearch(tabId, andTerms, orTerms, notTerms) {
  if (!andTerms.length && !orTerms.length && !notTerms.length) {
    return { ok: true, blocked: false, skipped: true };
  }

  const checkResult = await chrome.tabs.sendMessage(tabId, {
    type: 'CHECK_SEARCH_INPUTS', needAnd: andTerms.length > 0, needOr: orTerms.length > 0, needNot: notTerms.length > 0
  });
  if (!checkResult || checkResult.blocked) return { ok: false, blocked: true, skipped: false };
  if (!checkResult.ok) return { ok: false, blocked: false, skipped: false, missing: checkResult.missing };

  // 2026-09-02 실사용 확인 중 발견한 버그 수정: 새 값을 채우기 전에 반드시
  // 먼저 비운다 -- 안 그러면 예전 프로젝트에서 커밋된 키워드 칩 위에
  // 새 키워드가 그냥 더 쌓인다(CLEAR_SEARCH_TERMS 주석 참고). 이 버튼을
  // 못 찾아도(사람인 화면 구조가 바뀐 경우) 전체를 막지는 않는다 --
  // 못 지워도 채우기 자체는 여전히 시도해볼 가치가 있어서다.
  await chrome.tabs.sendMessage(tabId, { type: 'CLEAR_SEARCH_TERMS' }).catch(err => { console.log('[TS] CLEAR_SEARCH_TERMS 예외', err.message); return null; });
  await wait(CHIP_COMMIT_DELAY_MS);

  // 2026-09-02 실사용 확인 중 발견한 두 번째 버그: 칩 하나를 Enter로
  // 커밋할 때마다 그 즉시 검색이 다시 실행된다(라이브 확인, popup.js의
  // "정렬/최신순" 관련 기존 주석과 같은 발견) -- 즉 마지막 검색버튼
  // 클릭 시점에는 이미 마지막 키워드까지 다 반영된 뒤라, 그 시점을
  // "이전" 기준으로 잡으면(예전 코드) 검색버튼 클릭 자체는 아무것도
  // 안 바꾸므로 "결과가 안 바뀌었다"고 잘못 판단해서 멀쩡한 검색을
  // 실패로 처리하는 사고가 났다. 그래서 "이전" 기준은 첫 키워드를
  // 채우기 전(비우기 직후)의 화면으로 잡아야 한다.
  const beforeAnyFillResult = await chrome.tabs.sendMessage(tabId, { type: 'PARSE_CURRENT_LIST' }).catch(() => null);
  const firstCandidateIdBefore = (beforeAnyFillResult && beforeAnyFillResult.candidates && beforeAnyFillResult.candidates[0] && beforeAnyFillResult.candidates[0].sourceUrl) || null;

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (err) {
    console.log('[TS] chrome.debugger.attach 실패', err.message);
    return { ok: false, blocked: false, skipped: false, missing: ['DEBUGGER_ATTACH_FAILED: ' + err.message] };
  }
  try {
    const boxes = [['or', orTerms], ['and', andTerms], ['not', notTerms]];
    for (const [box, terms] of boxes) {
      for (const term of terms) {
        const fillResult = await chrome.tabs.sendMessage(tabId, { type: 'FILL_SEARCH_TERM', box, term });
        if (!fillResult || fillResult.blocked) return { ok: false, blocked: true, skipped: false };
        if (!fillResult.ok) return { ok: false, blocked: false, skipped: false, missing: [box.toUpperCase()] };
        try {
          await dispatchTrustedText(tabId, term);
          await dispatchTrustedEnter(tabId);
        } catch (err) {
          console.log('[TS] 텍스트/Enter 입력 예외', box, term, err.message);
        }
        await wait(CHIP_COMMIT_DELAY_MS);
      }
    }

    const clickResult = await chrome.tabs.sendMessage(tabId, { type: 'CLICK_SEARCH_BUTTON' });
    if (!clickResult || clickResult.blocked) return { ok: false, blocked: true, skipped: false };
    if (!clickResult.ok) return { ok: false, blocked: false, skipped: false };
    return { ok: true, blocked: false, skipped: false, firstCandidateIdBefore };
  } finally {
    // 디버깅 배너(크롬이 표시하는 "자동화 소프트웨어가 제어 중" 안내줄)를
    // 최소한만 띄우려고, 칩 커밋이 끝나는 즉시(페이지 넘기기 전에)
    // detach한다 -- 이후 CLICK_NEXT_PAGE/PARSE_CURRENT_LIST는 일반
    // 클릭이라 debugger가 필요 없다(라이브 확인: 트러스트 여부와
    // 무관하게 버튼 클릭 자체는 항상 실제 요청을 만들었음).
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

// 한국 시/도 17개(전국/해외 지역은 "구/군" 개념 자체가 없어서 뺐다).
// 2026-09-02 실사용 확인(팝업을 직접 열어 읽어봄) 기준 목록 -- 순서는
// 사람인 화면에 보이는 순서 그대로.
const TS_REGION_LIST = [
  '서울', '경기', '대구', '대전', '부산', '울산', '인천', '강원',
  '경남', '경북', '전남광주', '전북', '충북', '충남', '제주', '세종특별자치시'
];

// 시/도 하나를 선택하고, 지금 남은 구/군 중 그 시/도에서 찾을 수 있는
// 것만 체크한 뒤, 새로 찾은 이름들을 돌려준다(remaining Set은 호출부가
// 갱신한다 -- 이 함수는 그 세트를 직접 건드리지 않는다).
async function selectRegionAndCheckDistricts(tabId, region, remainingDistricts) {
  const selectResult = await chrome.tabs.sendMessage(tabId, { type: 'SELECT_REGION_LIST_ITEM', regionName: region }).catch(() => null);
  if (!selectResult || !selectResult.ok) return []; // 이 시/도 버튼을 못 찾아도 나머지는 계속 시도
  // 시/도를 바꾸면 오른쪽 구/군 체크박스 목록이 다시 그려진다 -- 그
  // 렌더링이 끝나기 전에 확인하면 화면에 아직 없는 항목을 놓칠 수
  // 있어서(실사용 확인 중 5개 중 2개를 놓친 사례 발견, 정확한 원인은
  // 못 밝혔지만 타이밍이 유력한 후보), 다른 어떤 대기보다 넉넉하게 둔다.
  await wait(randomPageDelayMs() + 1000);

  const checkResult = await chrome.tabs.sendMessage(tabId, {
    type: 'CHECK_DISTRICT_CHECKBOXES', districts: Array.from(remainingDistricts)
  }).catch(() => null);
  return (checkResult && checkResult.matchedNames) || [];
}

// 지역(구/군) 조건을 사람인 "지역 추가" 팝업에 적용한다. 원하는 구/군이
// 정확히 어느 시/도 소속인지 이 확장은 모르므로(사람인의 지역 분류를
// 따로 들고 있지 않음), 시/도를 하나씩 순회하며 그때그때 보이는 구/군
// 체크박스에서 이름이 일치하는 것만 체크한다 -- 이미 다 찾았으면
// (remaining이 비면) 남은 시/도는 건너뛴다. 같은 이름의 구/군이 여러
// 시/도에 있으면(예: "중구") 전부 체크될 수 있다는 걸 알아둘 것 --
// 이번 범위에서는 그 모호성을 따로 해소하지 않는다.
//
// 전체를 두 바퀴 돈다(REGION_SWEEP_PASSES) -- 첫 바퀴에서 실사용
// 확인 중 5개 중 2개를 놓치는 사례가 있었고(타이밍 문제로 추정,
// 정확한 원인은 못 밝힘), 놓친 구/군만 다시 전체를 훑으면 그런
// 일시적인 누락을 만회할 수 있다. 두 번째 바퀴에서도 안 잡히면
// notFound로 보고한다.
//
// 학력/정렬/최신순 필터와 마찬가지로 실패해도(사람인 화면 구조가
// 바뀐 경우) 전체 가져오기를 막지 않는다. 시/도를 최대 32번(2바퀴 ×
// 16개) 오가야 해서 다른 어떤 자동화보다 사람인과 상호작용이 많다 --
// 안전장치로 매 시/도 전환 사이에 넉넉한 지연을 둔다.
const REGION_SWEEP_PASSES = 2;

async function applyLocationDistricts(tabId, districts) {
  if (!districts.length) return { ok: true, skipped: true };

  const openResult = await chrome.tabs.sendMessage(tabId, { type: 'OPEN_REGION_PANEL' }).catch(() => null);
  if (!openResult || openResult.blocked) return { ok: false, blocked: !!(openResult && openResult.blocked), skipped: false };
  if (!openResult.ok) return { ok: false, blocked: false, skipped: false };
  await wait(randomPageDelayMs());

  const remaining = new Set(districts);
  for (let pass = 0; pass < REGION_SWEEP_PASSES && remaining.size; pass += 1) {
    for (const region of TS_REGION_LIST) {
      if (!remaining.size) break;
      const matched = await selectRegionAndCheckDistricts(tabId, region, remaining);
      matched.forEach(d => remaining.delete(d));
    }
  }

  const saveResult = await chrome.tabs.sendMessage(tabId, { type: 'SAVE_REGION_PANEL' }).catch(() => null);
  if (!saveResult || !saveResult.ok) return { ok: false, blocked: false, skipped: false, matchedCount: districts.length - remaining.size, notFound: Array.from(remaining) };

  return { ok: true, blocked: false, skipped: false, matchedCount: districts.length - remaining.size, notFound: Array.from(remaining) };
}

importBtn.addEventListener('click', async () => {
  const token = await loadSavedToken();
  const projectId = projectSelect.value;
  if (!token || !projectId) return;

  const target = Math.max(1, Number(targetCountInput.value) || 50);
  importBtn.disabled = true;

  const seenUrls = new Set();
  // 2026-09-03 추가: 같은 조건으로 여러 번(1차 조회, 2차 조회...) 실행할
  // 때 어느 페이지에서 저장한 후보든 "이번 클릭 한 번"을 같은 회차로
  // 묶어 HR 사이트에서 구분해 볼 수 있게, 클릭마다 새 식별자를 하나
  // 발급해 이번 세션의 모든 페이지 POST에 동일하게 실어 보낸다. 실제
  // 중복 방지(같은 사람이 두 번 저장되는 것 자체를 막는 것)는 이 값과
  // 무관하게 서버가 sourceUrl 유니크 제약으로 항상 보장한다.
  const batchKey = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let totalImported = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  let pageCount = 0;
  let stopReason = null;
  let locationNote = null;

  try {
    // 2026-09-02 실사용 확인 중 발견한 버그 수정: cachedApprovedProjects는
    // 팝업을 처음 열었을 때 딱 한 번만 불러온 스냅샷이라, 그 뒤 HR
    // 사이트에서 조건을 수정해도(팝업을 다시 열지 않으면) 예전 값을
    // 계속 쓰고 있었다. 실제로 조건을 바꾼 뒤에도 옛 키워드로 검색되는
    // 사고로 이어졌다 -- 그래서 버튼을 누르는 시점에 항상 최신 값을
    // 다시 가져온다. 목록 전체를 다시 불러오는 건 비효율적이지만
    // 이 프로젝트 규모(수십 개)에서는 무시할 수 있는 비용이다.
    let selectedProject;
    try {
      const freshRes = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects`, { headers: { Authorization: `Bearer ${token}` } });
      const freshData = await freshRes.json();
      if (freshRes.ok) {
        cachedApprovedProjects = freshData.projects.filter(p => p.status === 'approved');
      } else {
        console.log('[TS] 프로젝트 목록 갱신 실패', freshRes.status);
      }
    } catch (err) { console.log('[TS] 프로젝트 목록 갱신 중 예외', err.message); }
    selectedProject = cachedApprovedProjects.find(p => p.id === projectId);
    const { andTerms, orTerms, notTerms } = buildSearchTerms(selectedProject && selectedProject.keywords);

    importStatus.textContent = '검색 조건 채우는 중...';
    const [searchTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const searchResult = await fillAndSearch(searchTab.id, andTerms, orTerms, notTerms);

    let searchOk = false;
    if (searchResult && searchResult.blocked) {
      stopReason = '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요';
    } else if (!searchResult || !searchResult.ok) {
      const missingNote = searchResult && searchResult.missing ? ` (${searchResult.missing.join(', ')} 칸을 못 찾음)` : '';
      stopReason = `검색 조건을 채우지 못했어요 - 사람인 화면 구조가 바뀌었을 수 있어요${missingNote}`;
    } else {
      searchOk = true;
      if (!searchResult.skipped) {
        const firstCandidateIdBefore = searchResult.firstCandidateIdBefore || null;
        // 검색 클릭 직후 결과가 실제로 갱신됐는지 몇 번 더 확인한다(위
        // MAX_READINESS_POLL_ATTEMPTS 주석 참고). 클릭 전에 후보가 하나도
        // 없었다면(firstCandidateIdBefore가 null) 비교할 대상이 없으니
        // 기존처럼 지연 한 번만 두고 바로 진행한다.
        //
        // 2026-09-02 실사용 확인 중 발견한 버그 수정: 예전엔 다 확인해도
        // 결과가 안 바뀌면 "우연히 같을 수도 있다"고 보고 그냥 진행했는데,
        // 실제로는 검색이 적용 안 된 채(예전 화면 그대로) 엉뚱한 후보
        // 59명이 수집되는 사고로 이어졌다(인사회계 키워드인데 마케팅/
        // 국제무역 태그의 후보가 들어옴). 결과가 끝까지 안 바뀌면 이제
        // 우연으로 넘기지 않고 검색 실패로 처리해서 가져오기를 중단한다.
        let confirmedChanged = !firstCandidateIdBefore; // 비교 대상이 없으면 그냥 통과시킨다
        for (let attempt = 0; attempt < MAX_READINESS_POLL_ATTEMPTS && !confirmedChanged; attempt += 1) {
          await wait(randomPageDelayMs());

          const [readyTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          const peek = await chrome.tabs.sendMessage(readyTab.id, { type: 'PARSE_CURRENT_LIST' }).catch(() => null);
          if (peek && peek.blocked) { confirmedChanged = true; break; } // 아래 본 루프의 첫 PARSE_CURRENT_LIST가 다시 감지해 처리한다
          const firstNow = (peek && peek.candidates && peek.candidates[0] && peek.candidates[0].sourceUrl) || null;
          if (firstNow !== firstCandidateIdBefore) confirmedChanged = true; // 결과가 바뀐 것을 확인했으니 더 기다리지 않는다
        }
        if (!confirmedChanged) {
          searchOk = false;
          stopReason = '검색 결과가 안 바뀐 것 같아요 - 사람인에서 직접 확인 후 다시 시도해주세요(엉뚱한 후보가 수집되는 걸 막기 위해 중단했어요)';
        }
      }

      // 2026-09-02: 검색 결과 변경을 확인 못 해서 위에서 이미 searchOk를
      // false로 내렸다면(검색 실패), 아래 필터/학력/지역 적용은 어차피
      // 버려질 화면에 대고 사람인과 더 상호작용만 늘리는 셈이라 건너뛴다.
      if (searchOk) {
        // 정렬/최신순 필터는 키워드가 하나도 없어 검색을 건너뛴 프로젝트
        // 에서도 적용한다 -- 실패해도(사람인 화면 구조가 바뀐 경우) 전체
        // 가져오기를 막지는 않는다(APPLY_DEFAULT_LIST_FILTERS 주석 참고).
        const filtersResult = await chrome.tabs.sendMessage(searchTab.id, {
          type: 'APPLY_DEFAULT_LIST_FILTERS', freshnessValue: DEFAULT_UPDATE_FRESHNESS_VALUE, sortLabel: DEFAULT_SORT_LABEL
        }).catch(() => null);
        if (filtersResult && (filtersResult.freshnessApplied || filtersResult.sortApplied)) {
          // 필터/정렬 변경도 검색과 마찬가지로 실제 반영에 약간 시간이
          // 걸리므로, 아래 가져오기 루프가 옛 결과를 읽지 않도록 한 번 쉰다.
          await wait(randomPageDelayMs());
        }

        // 학력 조건(프로젝트별 설정, 고정 기본값 아님)도 같은 이유로
        // 적용한다 -- 실패해도 전체 가져오기를 막지 않는다
        // (APPLY_EDUCATION_LEVELS 주석 참고).
        const educationLevels = (selectedProject && selectedProject.educationLevels) || [];
        if (educationLevels.length) {
          const eduResult = await chrome.tabs.sendMessage(searchTab.id, {
            type: 'APPLY_EDUCATION_LEVELS', levels: educationLevels
          }).catch(() => null);
          if (eduResult && eduResult.appliedCount) await wait(randomPageDelayMs());
        }

        // 지역(구/군) 조건도 같은 이유로 적용한다. 시/도를 여러 번
        // 오가야 해서 다른 필터보다 시간이 걸린다(applyLocationDistricts
        // 주석 참고) -- importStatus에 진행 상황을 보여준다.
        const locationDistricts = (selectedProject && selectedProject.locationDistricts) || [];
        if (locationDistricts.length) {
          importStatus.textContent = '지역 조건 적용 중... (시/도를 여러 번 확인해서 시간이 좀 걸려요)';
          const locationResult = await applyLocationDistricts(searchTab.id, locationDistricts).catch(() => null);
          if (locationResult && locationResult.notFound && locationResult.notFound.length) {
            locationNote = `지역 조건 중 ${locationResult.notFound.join(', ')}은(는) 적용 못 했어요 - 사람인에서 직접 추가해주세요`;
          }
          await wait(randomPageDelayMs());
        }
      }
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
        // 같은 페이지를 다시 읽게 된 경우(다음 페이지 클릭이 실제로는
        // 안 먹힌 경우 등)를 새 후보 0명으로 자연스럽게 감지하기 위해,
        // 이번 "가져오기" 세션 동안 이미 본 sourceUrl은 다시 보내지
        // 않는다.
        const newCandidates = allCandidates.filter(c => c.sourceUrl && !seenUrls.has(c.sourceUrl));
        if (!newCandidates.length) {
          stopReason = pageCount === 1 ? '가져올 후보를 찾지 못했어요' : '더 이상 새로운 후보가 없어요';
          break;
        }
        newCandidates.forEach(c => seenUrls.add(c.sourceUrl));

        const res = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects/${projectId}/list-candidates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ platform: '사람인', batchKey, candidates: newCandidates })
        });
        const data = await res.json();
        if (!res.ok) {
          stopReason = data.error || '가져오기 실패';
          break;
        }

        totalImported += data.imported;
        totalSkipped += data.skipped || 0;
        totalDuplicates += data.duplicates || 0;

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

    if (totalImported === 0 && totalSkipped === 0 && totalDuplicates === 0) {
      importStatus.textContent = [stopReason || '가져올 후보를 찾지 못했어요', locationNote].filter(Boolean).join(' / ');
    } else {
      let summary = pageCount > 1
        ? `${pageCount}페이지에 걸쳐 ${totalImported}명 가져왔어요`
        : `${totalImported}명 가져왔어요`;
      if (totalSkipped) summary += ` (${totalSkipped}명은 조건에 안 맞아 제외)`;
      if (totalDuplicates) summary += ` (${totalDuplicates}명은 이미 가져온 사람이라 제외)`;
      if (stopReason) summary += ` — ${stopReason}`;
      if (locationNote) summary += ` / ${locationNote}`;
      importStatus.textContent = summary;
    }
  } catch (err) {
    // 예외가 나기 전까지 이미 몇 페이지·몇 명을 저장했는지 보여준다.
    const progress = totalImported > 0 || pageCount > 1
      ? ` (그때까지 ${pageCount}페이지에서 ${totalImported}명 저장됨)`
      : '';
    importStatus.textContent = `오류: ${err.message}${progress}`;
  } finally {
    importBtn.disabled = false;
  }
});

initListImportUiIfApplicable();

const btn = document.getElementById('extractBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');

function onProgress(message) {
  if (message.type === 'PROGRESS') {
    statusEl.textContent = `${message.current}/${message.total} 구간 처리 중...`;
  }
}

btn.addEventListener('click', async () => {
  resultEl.textContent = '';
  statusEl.textContent = '시작 중...';
  btn.disabled = true;
  chrome.runtime.onMessage.addListener(onProgress);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_EXTRACTION' });
    if (!response || !response.ok) {
      statusEl.textContent = (response && response.reason) || '알 수 없는 오류가 발생했어요';
      return;
    }
    statusEl.textContent = '완료';
    resultEl.textContent = response.text;
  } catch (err) {
    // "Receiving end does not exist"는 콘텐츠 스크립트가 아직 주입되지
    // 않은 탭(사람인 이력서 상세 페이지가 아니거나, 새로고침 직후)에
    // 메시지를 보낼 때만 나오는 실제 신호다. 그 외 에러(예: OCR/캡처
    // 실패가 background.js에서 예외로 올라온 경우)까지 전부 "이 페이지가
    // 아니라서"라고 안내하면 원인을 오도한다.
    const isNotInjected = typeof err.message === 'string' && err.message.includes('Receiving end does not exist');
    statusEl.textContent = isNotInjected
      ? `오류: ${err.message} (이 페이지에 확장이 연결되지 않았을 수 있어요 - 사람인 이력서 상세 페이지에서 시도해주세요)`
      : `오류: ${err.message}`;
  } finally {
    chrome.runtime.onMessage.removeListener(onProgress);
    btn.disabled = false;
  }
});
