// chrome-extension/popup.js
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
