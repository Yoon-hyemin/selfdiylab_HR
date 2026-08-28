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
    projectSelect.innerHTML = data.projects.map(p => `<option value="${p.id}">${p.title}</option>`).join('');
  } catch (err) {
    importStatus.textContent = `프로젝트 목록 오류: ${err.message}`;
  }
}

importBtn.addEventListener('click', async () => {
  const token = await loadSavedToken();
  const projectId = projectSelect.value;
  if (!token || !projectId) return;

  importStatus.textContent = '가져오는 중...';
  importBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const parseResult = await chrome.tabs.sendMessage(tab.id, { type: 'PARSE_CURRENT_LIST' });
    const candidates = (parseResult && parseResult.candidates) || [];
    if (!candidates.length) {
      importStatus.textContent = '가져올 후보를 찾지 못했어요';
      return;
    }

    const res = await fetch(`${HR_SITE_ORIGIN}/api/talent-search-projects/${projectId}/list-candidates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform: '사람인', candidates })
    });
    const data = await res.json();
    importStatus.textContent = res.ok ? `${data.imported}명 가져왔어요` : (data.error || '가져오기 실패');
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
