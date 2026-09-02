// chrome-extension/list-content-lib.js
/**
 * 사람인 검색결과 리스트 페이지의 후보 카드 하나를 파싱한다. DOM
 * Element를 인자로 받지만 chrome.* API나 네트워크 요청에는 의존하지
 * 않아서, jsdom으로 만든 요소를 넣어 node --test로 검증할 수 있다.
 *
 * 선택자는 2026-08-27 실사용 확인 기준(로그인해서 실제 인재풀 검색결과
 * 화면의 DOM을 직접 열어봄) -- 사람인이 화면 구조를 바꾸면 깨질 수
 * 있다. 후보 고유 ID는 카드에 href로 노출돼 있지 않고(링크가
 * `javascript:void(0)`) `.check_area`의 `residx` 속성에만 있어서,
 * 원문 이력서 URL은 이 속성값으로 직접 조립한다(오늘 상세 페이지
 * OCR 작업에서 이미 검증한 `hiring.saramin.co.kr/applicant-view/
 * position/resume/<ID>` 패턴과 동일). "특징 배지"(예: 인서울 대학,
 * 최장 근속)는 화면에는 아이콘으로만 보이고 텍스트는 툴팁
 * (`.TipTxt`) 안에만 있어서, 그 툴팁 문장을 그대로 배지 값으로 쓴다.
 * 필드를 못 찾으면 추측하지 않고 null/빈 배열로 둔다(이 프로젝트의
 * fail-closed 원칙 -- 잘못된 값을 지어내지 않는다).
 */
export function parseCandidateCard(cardElement) {
  const text = (selector) => {
    const found = cardElement.querySelector(selector);
    return found ? found.textContent.trim() : null;
  };
  const textAll = (selector) => Array.from(cardElement.querySelectorAll(selector)).map(el => el.textContent.trim());

  const genderAgeRaw = text('.summary_info .gender_age');
  const genderMatch = genderAgeRaw ? /^(남|여)/.exec(genderAgeRaw) : null;
  const ageMatch = genderAgeRaw ? /(\d+)\s*세/.exec(genderAgeRaw) : null;

  const residx = cardElement.querySelector('.check_area')?.getAttribute('residx') || null;

  return {
    maskedName: text('.summary_info .name') || null,
    gender: genderMatch ? genderMatch[1] : null,
    age: ageMatch ? Number(ageMatch[1]) : null,
    careerSummary: text('.summary_info .career_all') || null,
    recentPositions: Array.from(cardElement.querySelectorAll('.career_item .career_list > li')).map(li => ({
      company: (li.querySelector('.company_info') || {}).textContent?.trim() || '',
      period: (li.querySelector('.year_data') || {}).textContent?.trim() || '',
      note: (li.querySelector('.point_txt') || {}).textContent?.trim() || ''
    })),
    education: text('.education_item') || null,
    tags: textAll('.list_jobs_skill .item'),
    badges: Array.from(cardElement.querySelectorAll('.wrap_tag_item .tag_item_list > li'))
      .map(li => (li.querySelector('.TipTxt') || {}).textContent?.trim() || '')
      .filter(Boolean),
    lastUpdatedLabel: text('.talent_list_data p') || null,
    sourceUrl: residx ? `https://hiring.saramin.co.kr/applicant-view/position/resume/${residx}` : null
  };
}

// "다음 페이지" 요소를 찾는다. 2026-08-28 실사용 확인(로그인해서 실제
// 인재풀 검색결과 화면에서 직접 클릭해보고 페이지가 실제로 1→2로
// 넘어가는 것까지 확인함) 기준 정확한 선택자는 `.PageBox .BtnNext`다
// -- 처음엔 "다음" 텍스트만으로도 찾도록 만들었는데, 같은 화면 위쪽의
// "스페셜 태그" 캐러셀 다음 버튼(`#special_tag_next_btn`)도 접근성
// 텍스트가 똑같이 "다음"이라 텍스트만으로는 그 버튼을 먼저 찾아버리는
// 오탐이 실사용 확인 중 발견됐다(그 버튼은 DOM에서 페이지네이션보다
// 앞에 나와서 .find()가 그걸 먼저 집는다).
//
// `.PageBox`가 페이지에 존재하면 그게 페이지네이션의 유일한 진실
// 소스다 -- `.PageBox`는 있는데 그 안의 `.BtnNext`가 없거나(사람인이
// 구조를 바꿨거나) 비활성화돼 있으면(마지막 페이지), 문서 전체를 다시
// "다음" 텍스트로 훑는 폴백으로 넘어가지 않고 그냥 null을 반환한다 --
// 안 그러면 페이지 어딘가의 무관한 "다음" 버튼(캐러셀 이름으로 걸러낸
// 것 말고 또 다른 것)을 잘못 클릭해서 검색결과 탭 자체를 벗어나버릴
// 위험이 있다. 텍스트("다음") 기반 폴백은 `.PageBox` 자체가 문서에
// 아예 없을 때(사람인이 그 컨테이너 자체를 통째로 바꾼 경우)에만
// 쓴다 -- 이때도 오탐을 일으켰던 스페셜 태그 캐러셀(`.special_tag_wrap`,
// `.swiper`) 내부 요소는 제외한다. 비활성화된 요소(disabled 속성
// 또는 aria-disabled="true")는 항상 제외한다 -- 존재하지만 눌러도
// 반응 없는 요소를 클릭 성공으로 잘못 보고하면 CLICK_NEXT_PAGE
// 호출부가 무한정 같은 페이지를 반복하게 된다.
export function findNextPageButton(doc) {
  const isDisabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true'
    || (el.className && String(el.className).includes('disabled'));

  const box = doc.querySelector('.PageBox');
  if (box) {
    const next = box.querySelector('.BtnNext');
    return (next && !isDisabled(next)) ? next : null;
  }

  const isInKnownCarousel = el => !!el.closest('.special_tag_wrap, .swiper');
  const fallback = Array.from(doc.querySelectorAll('a, button')).find(el =>
    !isDisabled(el) && !isInKnownCarousel(el) && /^\s*다음\s*$/.test(el.textContent || '')
  );
  return fallback || null;
}

// 네이티브 input의 값 설정자를 통해 값을 바꾼 뒤 keyup/change 이벤트를
// 발생시킨다. `el.value = x`만으로는 프레임워크의 내부 상태가 갱신되지
// 않는 경우가 흔해서 네이티브 setter를 거쳐야 한다는 것까지는 맞지만,
// 2026-09-02 실사용 확인 중 사람인 인재풀 검색창에서는 그 뒤에 `input`
// 이벤트를 발생시키면 오히려 그 즉시(같은 틱 안에서 동기적으로) 값이
// 다시 빈 문자열로 되돌아가는 것을 발견했다 -- 아마 실시간 자동완성/
// 추천어 컴포넌트가 `input` 이벤트를 "아직 조합 중인 타이핑"으로
// 해석해서 초기화하는 것으로 추정된다. 반면 `change`/`keyup`
// 이벤트는 값을 되돌리지 않으면서도 화면의 "검색" 버튼이 최종 값을
// 읽어가는 데 필요한 이벤트로 확인됐다(라이브 콘솔에서 setter+keyup+
// change 조합으로 값이 유지되고, 그 뒤 검색 버튼 클릭도 그 값을
// 정상적으로 읽어가는 것까지 확인). `inputEl.ownerDocument.defaultView`로
// window를 구해서 jsdom 테스트와 실제 콘텐츠 스크립트 양쪽에서 동일하게
// 동작하게 한다(콘텐츠 스크립트에서 그냥 전역 window를 참조하면 jsdom
// 테스트 환경에서는 window가 없어 에러가 난다).
export function setNativeInputValue(inputEl, text) {
  const win = inputEl.ownerDocument.defaultView;
  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
  setter.call(inputEl, text);
  inputEl.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true }));
  inputEl.dispatchEvent(new win.Event('change', { bubbles: true }));
}

// 사람인 검색창의 OR/AND/NOT 3칸을 찾는다. 선택자는 2026-08-31 실사용
// 확인 기준(로그인해서 실제 인재풀 검색결과 화면의 DOM을 직접 열어봄)
// -- 세 칸 모두 placeholder/name/id가 없고 동일한 class
// (`search_input result`)를 공유해서, 처음 추정했던 placeholder/name
// 기반 탐색은 셋 다 못 찾고 매번 "검색 조건을 채우지 못했어요"로
// 실패했다(실사용 확인 중 발견). 실제로는 각 칸을 감싸는 부모 요소의
// class로만 구분된다: OR="search_default", AND="search_word_include",
// NOT="search_word_except". 컨테이너 자체가 없으면(사람인이 구조를
// 다시 바꾼 경우) 추측하지 않고 null로 둔다(이 프로젝트의 fail-closed
// 원칙).
export function findSearchInputs(doc) {
  const inContainer = (containerClass) => {
    const container = doc.querySelector('.' + containerClass);
    return container ? container.querySelector('input') : null;
  };
  return {
    or: inContainer('search_default'),
    and: inContainer('search_word_include'),
    not: inContainer('search_word_except')
  };
}

// 검색 버튼을 찾는다. 2026-08-31 실사용 확인 기준 정확한 선택자는
// `.search_form_wrap .search_submit`이다 -- findNextPageButton이 겪은
// "페이지 전체 텍스트 매칭이 캐러셀의 동명 버튼을 잘못 집는" 문제와
// 같은 위험을 피하려고 처음부터 컨테이너(`search_form_wrap`)로
// 스코프를 좁혀서 찾는다. 이 화면엔 "검색" 텍스트를 가진 버튼이
// 이 하나뿐인 것까지 실사용 확인 중 직접 확인했다(캐러셀 등 오탐
// 후보 없음) -- 그래도 배제 로직은 방어적으로 유지한다.
export function findSearchButton(doc, containerSelector) {
  const isDisabled = el => el.disabled || el.getAttribute('aria-disabled') === 'true'
    || (el.className && String(el.className).includes('disabled'));
  const isInKnownCarousel = el => !!el.closest('.special_tag_wrap, .swiper');

  const scope = doc.querySelector(containerSelector || '.search_form_wrap') || doc;
  return Array.from(scope.querySelectorAll('button')).find(el =>
    !isDisabled(el) && !isInKnownCarousel(el) && (el.textContent || '').trim() === '검색'
  ) || null;
}
