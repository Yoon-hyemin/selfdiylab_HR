// chrome-extension/background.js
// MV3 서비스워커. content.js가 스크롤 지점마다 보내는 캡처 요청을 받아
// 현재 탭 화면을 캡처하고, 오프스크린 문서에 OCR을 맡긴 뒤 결과를
// 돌려준다. 무거운 OCR 연산은 서비스워커가 아니라 오프스크린 문서에서
// 처리한다 -- 서비스워커는 idle 상태에서 언제든 종료될 수 있어 장시간
// 연산에 안 맞다.

import { runListImport, getActiveToken } from './import-runner.js';

const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreenDocument() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['WORKERS'],
    justification: 'Tesseract.js OCR은 Web Worker로 동작하며, 서비스워커에서는 안정적으로 못 돌려서 오프스크린 문서에서 실행한다.'
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'CAPTURE_AND_OCR') return false;

  (async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' });
      await ensureOffscreenDocument();
      const ocrResult = await chrome.runtime.sendMessage({ type: 'OCR_IMAGE', dataUrl });
      sendResponse({ text: ocrResult.text });
    } catch (err) {
      // 캡처(captureVisibleTab) 실패나 오프스크린 문서 왕복 실패를 그냥
      // 던지면 sendResponse가 한 번도 호출되지 않아서 호출부(content.js)에는
      // "message channel closed before a response was received" 같은 원인을
      // 알 수 없는 에러만 남는다 -- {text}와 구분되는 {error} 모양으로
      // 돌려줘서 호출부가 실패를 감지하고 진단할 수 있게 한다.
      sendResponse({ error: String(err) });
    }
  })();

  return true; // 비동기 응답을 위해 채널을 열어둔다
});

/* ---------- "목표 인원 채우기" 실행 (2026-09-29) ----------
 * 수집 로직(import-runner.js)을 팝업이 아니라 여기서 돌린다 -- 팝업은
 * 다른 곳을 클릭하면 닫히면서 진행 중인 수집도 같이 멈췄다. 시작 경로는
 * 두 가지다:
 *   1) 팝업의 [목표 인원 채우기] → START_LIST_IMPORT (지금 탭에서 바로 실행)
 *   2) HR 사이트의 [사람인에서 수집 시작] → hr-bridge.js → START_FROM_HR
 *      (이때 HR 사이트가 로그인 세션으로 받은 12시간짜리 임시 통행증도
 *      같이 와서 sessionToken으로 저장된다 -- 연결 코드 붙여넣기 불필요)
 *      → 여기서 사람인 인재풀 탭을 새로 열고, 그 탭이 다 뜨면 실행
 *      (로그인 화면으로 넘어갔다가 로그인 후 돌아오는 경우도 탭 id로
 *      계속 기다린다 -- 대기 정보는 서비스워커가 잠들어도 남도록
 *      chrome.storage.session에 둔다).
 * 진행 상황은 chrome.storage.local의 listImportState(팝업이 읽음)와
 * 사람인 탭 화면 위 안내줄(IMPORT_STATUS → list-content.js)로 보여준다.
 * 한 번에 하나만 돈다 -- 같은 사람인 계정으로 동시에 두 탭을 조작하면
 * 봇으로 보일 위험만 커진다.
 */
const TALENT_POOL_SEARCH_URL = 'https://www.saramin.co.kr/zf_user/memcom/talent-pool/main/search';
const TALENT_POOL_PATH = '/zf_user/memcom/talent-pool/';
let importRunning = false;

async function setImportState(state) {
  await chrome.storage.local.set({ listImportState: { ...state, updatedAt: Date.now() } });
}

async function startImport({ tabId, projectId, projectTitle, target }) {
  if (importRunning) return { ok: false, error: '이미 수집이 진행 중이에요 - 끝난 뒤 다시 시도해주세요' };
  const active = await getActiveToken();
  if (!active) return { ok: false, error: 'HR 사이트와 연결돼 있지 않아요 - HR 사이트 프로젝트 화면의 [사람인에서 수집 시작]으로 시작해주세요' };
  const extensionToken = active.token;

  importRunning = true;
  // 서비스워커는 확장 API 호출 없이 30초가 지나면 잠들 수 있다. 수집
  // 루프는 몇 초마다 탭에 메시지를 보내지만, 긴 대기(지역 순회 등)에도
  // 끊기지 않도록 20초마다 가벼운 API를 불러 깨어 있게 한다.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);
  const onStatus = (text, done) => {
    setImportState({ running: !done, text, projectId, projectTitle: projectTitle || '', tabId });
    chrome.tabs.sendMessage(tabId, { type: 'IMPORT_STATUS', text, done, projectTitle: projectTitle || '' }).catch(() => {});
  };
  onStatus('수집을 시작해요...', false);
  runListImport({ tabId, projectId, target, token: extensionToken, onStatus })
    .catch(err => onStatus(`오류: ${err.message}`, true))
    .finally(() => { importRunning = false; clearInterval(keepAlive); });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_LIST_IMPORT') {
    startImport(message).then(sendResponse);
    return true;
  }
  if (message.type === 'START_FROM_HR') {
    (async () => {
      if (importRunning) { sendResponse({ ok: false, error: '이미 수집이 진행 중이에요 - 끝난 뒤 다시 시도해주세요' }); return; }
      // HR 사이트가 로그인 세션으로 막 발급받은 임시 통행증을 저장한다 --
      // 이 덕분에 연결 코드를 손으로 붙여넣지 않아도 된다(없으면 예전
      // 연결 코드로 대신한다).
      if (message.token && message.tokenExpiresAt) {
        await chrome.storage.local.set({ sessionToken: { token: message.token, expiresAt: message.tokenExpiresAt } });
      }
      if (!(await getActiveToken())) { sendResponse({ ok: false, error: 'HR 사이트와 연결하지 못했어요 - HR 사이트를 새로고침한 뒤 다시 눌러주세요' }); return; }
      const tab = await chrome.tabs.create({ url: TALENT_POOL_SEARCH_URL, active: true });
      const { pendingAutoRuns = {} } = await chrome.storage.session.get('pendingAutoRuns');
      pendingAutoRuns[tab.id] = { projectId: message.projectId, projectTitle: message.projectTitle, target: message.target, createdAt: Date.now() };
      await chrome.storage.session.set({ pendingAutoRuns });
      await setImportState({ running: true, text: '사람인 화면을 여는 중... (로그인 화면이 뜨면 로그인해주세요)', projectId: message.projectId, projectTitle: message.projectTitle || '', tabId: tab.id });
      sendResponse({ ok: true });
    })();
    return true;
  }
  return false;
});

// 대기 중인 자동 실행은 그 탭이 사람인 인재풀 화면으로 다 뜬 순간 시작한다.
// 30분 넘게 로그인 등을 안 하고 방치된 대기는 버린다(엉뚱한 때에 갑자기
// 수집이 시작되지 않도록).
const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || !tab.url.includes(TALENT_POOL_PATH)) return;
  const { pendingAutoRuns = {} } = await chrome.storage.session.get('pendingAutoRuns');
  const pending = pendingAutoRuns[tabId];
  if (!pending) return;
  delete pendingAutoRuns[tabId];
  await chrome.storage.session.set({ pendingAutoRuns });
  if (Date.now() - pending.createdAt > PENDING_MAX_AGE_MS) return;
  // 화면 스크립트(검색창 등)가 자리 잡을 시간을 조금 준다.
  await new Promise(r => setTimeout(r, 3000));
  const result = await startImport({ tabId, projectId: pending.projectId, projectTitle: pending.projectTitle, target: pending.target });
  if (!result.ok) await setImportState({ running: false, text: result.error, projectId: pending.projectId, projectTitle: pending.projectTitle || '', tabId });
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const { pendingAutoRuns = {} } = await chrome.storage.session.get('pendingAutoRuns');
  if (pendingAutoRuns[tabId]) {
    delete pendingAutoRuns[tabId];
    await chrome.storage.session.set({ pendingAutoRuns });
  }
});
