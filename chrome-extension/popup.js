// chrome-extension/popup.js
const HR_SITE_ORIGIN = 'http://localhost:3000'; // 로컬 개발용. 배포 시 별도로 바꿔야 함(이번 계획 범위 밖).

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
// 넘긴 뒤 다시 누르면 된다.
const MAX_PAGES = 5;

function randomPageDelayMs() {
  // 페이지 이동마다 정확히 같은 간격으로 클릭하지 않도록 2.5~4.5초
  // 사이 무작위 지연을 둔다(사람처럼 보이게 하는 안전장치 -- 실행엔진
  // OCR 작업 중 실제로 2단계인증을 겪은 적이 있어서 도입).
  return 2500 + Math.random() * 2000;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

importBtn.addEventListener('click', async () => {
  const token = await loadSavedToken();
  const projectId = projectSelect.value;
  if (!token || !projectId) return;

  const target = Math.max(1, Number(targetCountInput.value) || 50);
  importBtn.disabled = true;

  const seenUrls = new Set();
  let totalImported = 0;
  let totalSkipped = 0;
  let pageCount = 0;
  let stopReason = null;

  try {
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

    if (totalImported === 0) {
      importStatus.textContent = stopReason || '가져올 후보를 찾지 못했어요';
    } else {
      let summary = pageCount > 1
        ? `${pageCount}페이지에 걸쳐 ${totalImported}명 가져왔어요`
        : `${totalImported}명 가져왔어요`;
      if (totalSkipped) summary += ` (${totalSkipped}명은 조건에 안 맞아 제외)`;
      if (stopReason) summary += ` — ${stopReason}`;
      importStatus.textContent = summary;
    }
  } catch (err) {
    importStatus.textContent = `오류: ${err.message}`;
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
