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
