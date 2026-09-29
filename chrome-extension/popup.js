// chrome-extension/popup.js
import { HR_SITE_ORIGIN } from './import-runner.js';

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
const pageHint = document.getElementById('pageHint');
const runStatus = document.getElementById('runStatus');


async function initListImportUiIfApplicable() {
  const token = await loadSavedToken();
  tokenStatus.textContent = token ? '연결 코드 저장됨' : '연결 코드를 입력해주세요';
  if (!token) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isListPage = tab.url && tab.url.includes('/zf_user/memcom/talent-pool/');
  if (!isListPage) {
    // 2026-09-29: 전엔 아무 안내 없이 빈 채로 끝나서 "진행이 안 된다"로
    // 오해받았다(실사용 피드백). 어디서 누르면 되는지 알려준다.
    pageHint.textContent = '수집은 HR 사이트 프로젝트 화면의 [사람인에서 수집 시작] 버튼으로 시작하면 돼요. 여기서 직접 하려면 사람인 인재풀 검색 화면에서 이 아이콘을 다시 눌러주세요.';
    return;
  }

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

// 2026-09-29: 수집 로직은 import-runner.js로 옮겨 background.js(서비스워커)가
// 실행한다 -- 팝업은 다른 곳을 클릭하면 닫히면서 진행 중인 수집도 같이
// 멈췄기 때문이다. 팝업은 이제 시작 신호만 보내고, 진행 상황은
// chrome.storage.local의 listImportState를 읽어 보여준다(팝업을 닫았다
// 다시 열어도 이어서 보인다).
importBtn.addEventListener('click', async () => {
  const projectId = projectSelect.value;
  if (!projectId) return;
  const target = Math.max(1, Number(targetCountInput.value) || 50);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const projectTitle = projectSelect.selectedOptions[0] ? projectSelect.selectedOptions[0].textContent : '';
  importBtn.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'START_LIST_IMPORT', tabId: tab.id, projectId, projectTitle, target }).catch(err => ({ ok: false, error: err.message }));
  if (!result || !result.ok) {
    importStatus.textContent = (result && result.error) || '수집을 시작하지 못했어요';
    importBtn.disabled = false;
  }
});

// 서비스워커가 수집 도중 강제로 멈추면 running:true가 그대로 남을 수 있어서,
// 10분 넘게 소식이 없으면 끝난 것으로 본다(버튼이 영영 잠기지 않도록 --
// 지역 조건 순회는 몇 분간 새 소식 없이 돌 수 있어서 넉넉히 잡았다).
const STALE_STATE_MS = 10 * 60 * 1000;

function renderImportState(state) {
  if (!state) return;
  const running = state.running && Date.now() - (state.updatedAt || 0) < STALE_STATE_MS;
  const prefix = state.projectTitle ? `[${state.projectTitle}] ` : '';
  importStatus.textContent = prefix + (state.text || '');
  importBtn.disabled = running;
  runStatus.textContent = running ? `수집 중: ${prefix}${state.text || ''}` : '';
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.listImportState) renderImportState(changes.listImportState.newValue);
});
chrome.storage.local.get('listImportState').then(({ listImportState }) => renderImportState(listImportState));

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
