// chrome-extension/list-content.js
// 사람인 검색결과 리스트 페이지에 주입된다. 팝업의 "이 페이지
// 가져오기" 클릭을 받으면(PARSE_CURRENT_LIST) 로그인/인증 화면인지
// 먼저 확인하고(오늘 상세 페이지 작업 때 세운 원칙과 동일 -- 2단계인증
// 화면을 실제로 겪어봤다), 아니면 현재 화면에 보이는 후보 카드들을
// 파싱해서 돌려준다. 페이지를 스크롤하거나 다음 페이지로 넘기지
// 않는다 -- "지금 보이는 페이지만" 가져오는 게 이번 슬라이스의
// 의도된 범위다. 이 파일은 manifest에 classic 스크립트로 선언돼 있어
// 최상위 import 문을 쓸 수 없다 -- 순수 함수는 동적 import()로
// 가져온다(content.js와 동일한 패턴).

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

// 실제 후보 카드를 감싸는 반복 요소의 선택자. Task 6 Step 1(실제
// 사람인 페이지 DOM 확인)은 실제 페이지에 접근할 수 없는 환경이라
// 스킵됐다 -- 이 자리표시자 선택자는 실제 페이지 구조를 확인하기
// 전에 작성된 것이라 그대로 두면 동작하지 않는다. 실사용 전 반드시
// 실제 화면을 열어 확인한 뒤 고쳐야 한다.
const CANDIDATE_CARD_SELECTOR = '[data-testid="candidate-card"]';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'PARSE_CURRENT_LIST') return false;

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
});
