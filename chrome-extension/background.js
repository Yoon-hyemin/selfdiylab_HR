// chrome-extension/background.js
// MV3 서비스워커. content.js가 스크롤 지점마다 보내는 캡처 요청을 받아
// 현재 탭 화면을 캡처하고, 오프스크린 문서에 OCR을 맡긴 뒤 결과를
// 돌려준다. 무거운 OCR 연산은 서비스워커가 아니라 오프스크린 문서에서
// 처리한다 -- 서비스워커는 idle 상태에서 언제든 종료될 수 있어 장시간
// 연산에 안 맞다.

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
