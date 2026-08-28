// chrome-extension/list-content.js
// 사람인 검색결과 리스트 페이지에 주입된다. 팝업의 "이 페이지
// 가져오기" 클릭을 받으면(PARSE_CURRENT_LIST) 로그인/인증 화면인지
// 먼저 확인하고(2단계인증 화면을 실제로 겪어봤다), 아니면 현재 화면에
// 보이는 후보 카드들을 파싱해서 돌려준다. 목표 인원을 채우기 위해
// 팝업이 여러 페이지를 반복 수집할 때는 CLICK_NEXT_PAGE로 "다음
// 페이지" 요소를 대신 찾아 클릭한다(2026-08-28 추가) -- 이 파일
// 자체는 스크롤하거나 페이지를 판단하지 않는다, 클릭 한 번만 담당하고
// 반복 여부와 페이지 간 지연은 팝업(popup.js)이 주도한다. 이 파일은
// manifest에 classic 스크립트로 선언돼 있어 최상위 import 문을 쓸 수
// 없다 -- 순수 함수는 동적 import()로 가져온다(content.js와 동일한
// 패턴).

let libPromise = null;
function getLib() {
  if (!libPromise) {
    libPromise = import(chrome.runtime.getURL('list-content-lib.js'));
  }
  return libPromise;
}

// isBlockedPage는 content-lib.js(상세 페이지용 콘텐츠 스크립트가 이미
// 쓰는 파일)에 있다 -- 새 파일로 중복 정의하지 않고 그대로 재사용한다.
// manifest.json의 web_accessible_resources가 www.saramin.co.kr에도
// content-lib.js를 이미 노출하고 있어(Task 6에서 추가) 이 페이지에서도
// 동적 import가 가능하다.
let blockedCheckPromise = null;
function getBlockedCheck() {
  if (!blockedCheckPromise) {
    blockedCheckPromise = import(chrome.runtime.getURL('content-lib.js'));
  }
  return blockedCheckPromise;
}

// 실제 후보 카드를 감싸는 반복 요소의 선택자. 2026-08-27 실사용
// 확인 완료(로그인해서 실제 인재풀 검색결과 화면의 DOM을 직접 확인함).
const CANDIDATE_CARD_SELECTOR = '.talent_list_item';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PARSE_CURRENT_LIST') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        // 로그인/2단계인증 화면에서는 카드 선택자가 그냥 하나도 안
        // 걸려서 "0명"으로 조용히 성공한 것처럼 보일 위험이 있다 --
        // blocked 플래그로 구분해서 팝업이 다른 메시지를 보여주게 한다.
        sendResponse({ candidates: [], blocked: true });
        return;
      }

      const { parseCandidateCard } = await getLib();
      const cards = Array.from(document.querySelectorAll(CANDIDATE_CARD_SELECTOR));
      const candidates = cards.map(parseCandidateCard).filter(c => c.maskedName && c.sourceUrl);
      sendResponse({ candidates, blocked: false });
    })();
    return true; // 비동기 응답을 위해 채널을 열어둔다
  }

  if (message.type === 'CLICK_NEXT_PAGE') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        // 클릭 자체가 예상 못한 팝업/리디렉션을 유발할 수 있어서
        // 클릭 전에도 한 번 더 확인한다(PARSE_CURRENT_LIST 쪽과 이중
        // 방어).
        sendResponse({ hasNextPage: false, blocked: true });
        return;
      }

      const { findNextPageButton } = await getLib();
      const nextBtn = findNextPageButton(document);
      if (!nextBtn) {
        sendResponse({ hasNextPage: false, blocked: false });
        return;
      }
      nextBtn.click();
      sendResponse({ hasNextPage: true, blocked: false });
    })();
    return true;
  }

  return false;
});
