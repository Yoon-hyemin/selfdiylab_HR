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
  const { isBlockedPage, computeScrollSteps, pickScrollTarget } = await getLib();

  if (isBlockedPage(location.href, document.title)) {
    sendResponse({ ok: false, reason: '로그인/인증이 필요합니다 - 직접 처리 후 다시 시도해주세요' });
    return;
  }

  const container = findResumeContainer();
  if (!container) {
    sendResponse({ ok: false, reason: '이력서 화면을 찾지 못했습니다' });
    return;
  }

  // <main>이 자체 스크롤바를 갖고 있는 레이아웃도 있고, <main>은 콘텐츠
  // 높이만큼 늘어나고 실제 스크롤은 문서(body/html) 레벨에서 일어나는
  // 레이아웃도 있다 -- 후자인데 <main> 기준으로만 스크롤 스텝을 계산하면
  // maxScrollTop이 0으로 나와서 첫 화면 한 장만 캡처하고 "완료"로 조용히
  // 끝나버린다(이 프로젝트의 fail-closed 원칙 위반). pickScrollTarget으로
  // 실제 스크롤 가능한 대상을 먼저 판별한다.
  const scrollTarget = pickScrollTarget(
    container.scrollHeight,
    container.clientHeight,
    document.scrollingElement.scrollHeight,
    window.innerHeight
  );

  let steps;
  let scrollTo;
  if (scrollTarget === 'main') {
    steps = computeScrollSteps(container.scrollHeight, container.clientHeight);
    scrollTo = top => container.scrollTo({ top, behavior: 'instant' });
  } else if (scrollTarget === 'document') {
    steps = computeScrollSteps(document.scrollingElement.scrollHeight, window.innerHeight);
    scrollTo = top => document.scrollingElement.scrollTo({ top, behavior: 'instant' });
  } else {
    // 스크롤할 대상이 없다 -- 이력서가 이미 한 화면 안에 다 들어와 있는
    // 경우로, computeScrollSteps가 이런 입력에도 [0] 하나만 돌려주는
    // 경로를 그대로 재사용한다(스크롤 호출은 생략).
    steps = [0];
    scrollTo = null;
  }

  const segments = [];

  for (let i = 0; i < steps.length; i++) {
    if (scrollTo) {
      scrollTo(steps[i]);
      await new Promise(resolve => setTimeout(resolve, 400)); // 스크롤 후 렌더링 안정화 대기
    }

    const captureResult = await chrome.runtime.sendMessage({ type: 'CAPTURE_AND_OCR' });
    if (captureResult && captureResult.error) {
      // background.js가 캡처/OCR 실패를 {error}로 돌려준 경우 -- 실패한
      // 세그먼트를 조용히 건너뛰지 않고 즉시 중단해서 부분 성공을 "완료"로
      // 잘못 보고하지 않는다.
      sendResponse({ ok: false, reason: captureResult.error });
      return;
    }
    segments.push(captureResult.text);

    // 팝업이 응답을 안 받아도(닫혀 있어도) 실패로 취급하지 않는다 --
    // 진행률 알림은 받는 쪽이 없어도 흐름에 영향이 없어야 하는
    // fire-and-forget이라 처리되지 않은 프라미스 거부만 조용히 삼킨다.
    chrome.runtime.sendMessage({ type: 'PROGRESS', current: i + 1, total: steps.length }).catch(() => {});
  }

  const { stitchText } = await import(chrome.runtime.getURL('ocr-lib.js'));
  sendResponse({ ok: true, text: stitchText(segments) });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'START_EXTRACTION') return false;
  runExtraction(sendResponse);
  return true; // 비동기 응답을 위해 채널을 열어둔다
});
