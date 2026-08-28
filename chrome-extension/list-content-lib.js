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
