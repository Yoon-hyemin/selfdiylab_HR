// chrome-extension/content.js
// 사람인 후보 상세 이력서 페이지에 주입된다. 팝업의 "정보 추출" 클릭을
// 받으면(START_EXTRACTION) 로그인/인증 화면인지 먼저 확인하고, 아니면
// 이력서 영역을 스크롤하면서 매 지점을 background.js에 캡처+OCR
// 요청한다. 이 파일은 manifest에 classic 스크립트로 선언돼 있어
// 최상위 import 문을 쓸 수 없다 -- 순수 함수는 동적 import()로 가져온다.

let libPromise = null;
function getLib() {
  if (!libPromise) {
    libPromise = import(chrome.runtime.getURL('content-lib.js'));
  }
  return libPromise;
}

function findResumeContainer() {
  // 오늘 실사용 확인 기준, 이력서 상세 화면의 실제 콘텐츠는 <main> 안에
  // 렌더링된다. document.scrollingElement 같은 항상-존재하는 폴백은 쓰지
  // 않는다 -- <main>이 없으면(사이트 구조가 바뀐 경우) 추측해서 아무
  // 영역이나 캡처하지 않고 명확히 실패해야 하기 때문이다.
  return document.querySelector('main');
}

async function runExtraction(sendResponse) {
  const { isBlockedPage, computeScrollSteps } = await getLib();

  if (isBlockedPage(location.href, document.title)) {
    sendResponse({ ok: false, reason: '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요' });
    return;
  }

  const container = findResumeContainer();
  if (!container) {
    sendResponse({ ok: false, reason: '이력서 화면을 찾지 못했습니다' });
    return;
  }

  const steps = computeScrollSteps(container.scrollHeight, window.innerHeight);
  const segments = [];

  for (let i = 0; i < steps.length; i++) {
    container.scrollTo({ top: steps[i], behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 400)); // 스크롤 후 렌더링 안정화 대기

    const captureResult = await chrome.runtime.sendMessage({ type: 'CAPTURE_AND_OCR' });
    segments.push(captureResult.text);

    chrome.runtime.sendMessage({ type: 'PROGRESS', current: i + 1, total: steps.length });
  }

  const { stitchText } = await import(chrome.runtime.getURL('ocr-lib.js'));
  sendResponse({ ok: true, text: stitchText(segments) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'START_EXTRACTION') return false;
  runExtraction(sendResponse);
  return true; // 비동기 응답을 위해 채널을 열어둔다
});
