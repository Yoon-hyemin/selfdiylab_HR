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
//
// 검색어 자동입력(2026-09-02 재설계)은 이 파일 하나로 안 끝난다 --
// CHECK_SEARCH_INPUTS(필요한 칸이 다 있는지 사전확인)/
// FILL_SEARCH_TERM(칸 하나에 값 채우기)/CLICK_SEARCH_BUTTON(검색
// 버튼 클릭)으로 쪼개져 있고, 그 사이사이 "칩으로 확정하는 Enter
// 키"는 콘텐츠 스크립트가 못 만든다(합성 이벤트는 이 사이트가
// 무시하는 것을 실사용 확인함) -- popup.js가 chrome.debugger로
// 보내는 진짜 키 입력이 그 역할을 한다. 이 파일은 여전히 "값 채우기/
// 버튼 찾기/클릭"만 담당하고, 언제 어떤 칸에 무엇을 채울지와 Enter
// 타이밍은 popup.js가 주도한다.

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

  // 2026-09-02 실사용 확인으로 FILL_AND_SEARCH(값을 채우고 바로 버튼을
  // 누르는 방식)를 폐기했다 -- 사람인 검색창은 텍스트칸이 아니라 "칩
  // 태그" 입력(키워드를 입력하고 Enter를 눌러야 확정되고, 확정된
  // 칩만 실제 검색에 반영됨)이었고, 그 확정(Enter) 동작은 브라우저가
  // "진짜 사용자 입력"으로 인정하는 신호에만 반응해서, 콘텐츠
  // 스크립트가 만드는 합성 이벤트(keydown/keyup 등, 전부
  // isTrusted=false)로는 아무리 다양한 이벤트를 시도해도 커밋이 되지
  // 않았다(라이브 확인: 값은 화면에 채워지지만 실제 검색 요청에는
  // 반영 안 됨). 값 자체를 채우는 것(FILL_SEARCH_TERM)은 여전히 이
  // 콘텐츠 스크립트가 하되(신뢰 여부와 무관하게 값은 정상적으로
  // 채워지는 것까지 확인됨), 그 다음 칩으로 확정하는 Enter 키
  // 입력은 popup.js가 chrome.debugger(Input.dispatchKeyEvent)로 보내는
  // "진짜" 키 입력에 맡긴다 -- 콘텐츠 스크립트는 debugger API에 접근할
  // 수 없어서(확장 페이지 전용 API), 이 역할 분담이 불가피하다.
  if (message.type === 'CHECK_SEARCH_INPUTS') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        sendResponse({ ok: false, blocked: true });
        return;
      }
      const { findSearchInputs } = await getLib();
      const inputs = findSearchInputs(document);
      const { needAnd, needOr, needNot } = message;
      const missing = [];
      if (needAnd && !inputs.and) missing.push('AND');
      if (needOr && !inputs.or) missing.push('OR');
      if (needNot && !inputs.not) missing.push('NOT');
      sendResponse({ ok: missing.length === 0, blocked: false, missing });
    })();
    return true;
  }

  if (message.type === 'FILL_SEARCH_TERM') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        sendResponse({ ok: false, blocked: true });
        return;
      }
      const { setNativeInputValue, findSearchInputs } = await getLib();
      const inputs = findSearchInputs(document);
      const input = inputs[message.box];
      if (!input) {
        sendResponse({ ok: false, blocked: false });
        return;
      }
      // 칩 입력창은 이전 칩들과 별개인 "지금 타이핑 중" 버퍼 하나만
      // 노출한다 -- 이전 칩(예: 이미 커밋된 다른 키워드)은 이 input의
      // value에 안 보이므로 그대로 두고, 지금 커밋할 키워드 하나만
      // 채운다. 커밋(Enter)은 popup.js가 이어서 보낸다.
      input.focus();
      setNativeInputValue(input, message.term);
      sendResponse({ ok: true, blocked: false });
    })();
    return true;
  }

  if (message.type === 'CLICK_SEARCH_BUTTON') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        sendResponse({ ok: false, blocked: true });
        return;
      }
      const { findSearchButton, parseCandidateCard } = await getLib();
      const searchBtn = findSearchButton(document);
      if (!searchBtn) {
        sendResponse({ ok: false, blocked: false });
        return;
      }
      // 검색 버튼을 누르기 직전, 지금 화면 맨 위 후보의 sourceUrl을
      // 미리 남겨둔다 -- randomPageDelayMs()는 사람처럼 보이기 위한
      // 지연일 뿐 "결과가 실제로 갱신됐는지"를 보장하지 않아서, 팝업이
      // 이 값을 검색 후 PARSE_CURRENT_LIST 결과와 비교해 화면이 실제로
      // 바뀔 때까지 몇 번 더 확인(readiness poll)하는 데 쓴다.
      const firstCard = document.querySelector(CANDIDATE_CARD_SELECTOR);
      const firstCandidateIdBefore = firstCard ? parseCandidateCard(firstCard).sourceUrl : null;
      searchBtn.click();
      sendResponse({ ok: true, blocked: false, firstCandidateIdBefore });
    })();
    return true;
  }

  // 2026-09-02 추가: 정렬(추천순/업데이트일순)과 "업데이트 N 이내"
  // 필터는 키워드 칩과 달리 합성 이벤트로도 실제 검색을 다시
  // 일으킨다(실사용 확인) -- chrome.debugger 없이 이 콘텐츠 스크립트
  // 안에서 전부 처리한다. 이 둘은 "고정 기본값"이라 못 찾아도(사람인
  // 화면이 바뀐 경우) 전체 가져오기를 막을 정도는 아니라고 판단해서,
  // 실패해도 ok:false만 돌려주고 popup.js가 계속 진행하게 한다(FILL_
  // SEARCH_TERM과 달리 fail-closed로 전체를 중단시키지 않음).
  if (message.type === 'APPLY_DEFAULT_LIST_FILTERS') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        sendResponse({ ok: false, blocked: true, freshnessApplied: false, sortApplied: false });
        return;
      }
      const { findUpdateFreshnessSelect, setNativeSelectValue, findSortButton } = await getLib();
      const { freshnessValue, sortLabel } = message;

      let freshnessApplied = false;
      const freshnessSelect = findUpdateFreshnessSelect(document);
      if (freshnessSelect && freshnessSelect.value !== freshnessValue) {
        setNativeSelectValue(freshnessSelect, freshnessValue);
        freshnessApplied = true;
      }

      // 이미 선택된 정렬을 다시 누르면 오름/내림차순이 뒤집힐 수 있어서
      // (실사용 확인: 클릭 후 클래스에 arrow_down이 붙는 것으로 보아
      // 방향 토글 가능성이 있음), 아직 활성화 안 된 경우에만 클릭한다.
      let sortApplied = false;
      const sortBtn = findSortButton(document, sortLabel);
      if (sortBtn && !sortBtn.className.includes('active')) {
        sortBtn.click();
        sortApplied = true;
      }

      sendResponse({ ok: true, blocked: false, freshnessApplied, sortApplied });
    })();
    return true;
  }

  // 2026-09-02 추가: 학력 필터(고정 5개 체크박스, 팝업 없음)를 프로젝트의
  // educationLevels에 맞춰 체크한다. 정렬/최신순과 마찬가지로 "고정
  // 기본값"이 아니라 프로젝트별 조건이지만, 사이드바 필터라는 점에서는
  // 같은 부류라 이 메시지도 실패해도 ok:false만 돌려주고 전체 가져오기를
  // 막지 않는다(키워드 칩과 달리 fail-closed 대상 아님).
  if (message.type === 'APPLY_EDUCATION_LEVELS') {
    (async () => {
      const { isBlockedPage } = await getBlockedCheck();
      if (isBlockedPage(location.href, document.title)) {
        sendResponse({ ok: false, blocked: true, appliedCount: 0, notFound: [] });
        return;
      }
      const { findEducationCheckboxLabel } = await getLib();
      const { levels } = message;
      let appliedCount = 0;
      const notFound = [];
      for (const level of levels) {
        const label = findEducationCheckboxLabel(document, level);
        if (!label) { notFound.push(level); continue; }
        const input = document.getElementById(label.getAttribute('for'));
        if (input && !input.checked) {
          label.click();
          appliedCount += 1;
        }
      }
      sendResponse({ ok: true, blocked: false, appliedCount, notFound });
    })();
    return true;
  }

  return false;
});
