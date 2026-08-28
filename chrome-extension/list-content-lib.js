// chrome-extension/list-content-lib.js
/**
 * 사람인 검색결과 리스트 페이지의 후보 카드 하나를 파싱한다. DOM
 * Element를 인자로 받지만 chrome.* API나 네트워크 요청에는 의존하지
 * 않아서, jsdom으로 만든 요소를 넣어 node --test로 검증할 수 있다.
 *
 * 주의: 아래 선택자(`[data-field="..."]`)는 실제 사람인 페이지의 DOM
 * 구조를 확인하기 전에 작성된 미검증 자리표시자다(Task 6 Step 1 -- 실제
 * 페이지 접근 불가로 스킵됨). 실사용 전 반드시 실제 화면을 열어 확인한
 * 뒤 선택자를 고쳐야 한다. 필드를 못 찾으면 추측하지 않고 null/빈
 * 배열로 둔다 (이 프로젝트의 fail-closed 원칙 -- 잘못된 값을 지어내지
 * 않는다).
 */
export function parseCandidateCard(cardElement) {
  const text = (selector) => {
    const found = cardElement.querySelector(selector);
    return found ? found.textContent.trim() : null;
  };
  const textAll = (selector) => Array.from(cardElement.querySelectorAll(selector)).map(el => el.textContent.trim());

  return {
    maskedName: text('[data-field="name"]') || null,
    gender: text('[data-field="gender"]') || null,
    age: (() => {
      const raw = text('[data-field="age"]');
      const match = raw ? /(\d+)/.exec(raw) : null;
      return match ? Number(match[1]) : null;
    })(),
    careerSummary: text('[data-field="career-summary"]') || null,
    recentPositions: Array.from(cardElement.querySelectorAll('[data-field="position"]')).map(el => ({
      company: (el.querySelector('[data-field="company"]') || {}).textContent?.trim() || '',
      period: (el.querySelector('[data-field="period"]') || {}).textContent?.trim() || '',
      note: (el.querySelector('[data-field="note"]') || {}).textContent?.trim() || ''
    })),
    education: text('[data-field="education"]') || null,
    tags: textAll('[data-field="tag"]'),
    badges: textAll('[data-field="badge"]'),
    lastUpdatedLabel: text('[data-field="updated"]') || null,
    sourceUrl: cardElement.dataset.resumeUrl || null
  };
}
