// chrome-extension/list-content.js
// 사람인 검색결과 리스트 페이지에 주입된다. 팝업의 "이 페이지
// 가져오기" 클릭을 받으면(PARSE_CURRENT_LIST) 현재 화면에 보이는
// 후보 카드들을 파싱해서 돌려준다. 페이지를 스크롤하거나 다음
// 페이지로 넘기지 않는다 -- "지금 보이는 페이지만" 가져오는 게
// 이번 슬라이스의 의도된 범위다. 이 파일은 manifest에 classic
// 스크립트로 선언돼 있어 최상위 import 문을 쓸 수 없다 -- 순수
// 함수는 동적 import()로 가져온다(content.js와 동일한 패턴).

let libPromise = null;
function getLib() {
  if (!libPromise) {
    libPromise = import(chrome.runtime.getURL('list-content-lib.js'));
  }
  return libPromise;
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
    const { parseCandidateCard } = await getLib();
    const cards = Array.from(document.querySelectorAll(CANDIDATE_CARD_SELECTOR));
    const candidates = cards.map(parseCandidateCard).filter(c => c.maskedName && c.sourceUrl);
    sendResponse({ candidates });
  })();

  return true; // 비동기 응답을 위해 채널을 열어둔다
});
