// chrome-extension/list-content-lib.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseCandidateCard, findNextPageButton, setNativeInputValue, findSearchInputs, findSearchButton, findSortButton, findUpdateFreshnessSelect, setNativeSelectValue, findEducationCheckboxLabel } from './list-content-lib.js';

function cardFromHtml(html) {
  const dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
  return dom.window.document.querySelector('#root > *');
}

// 2026-08-27 실제 사람인 인재풀 검색결과 화면에서 확인한 실제 DOM
// 구조를 그대로 재현한 fixture(클래스명 전부 실사용 확인됨).
test('parseCandidateCard: 필드가 다 있는 카드를 정확히 파싱한다', () => {
  const card = cardFromHtml(`
    <div class="talent_list_item">
      <div class="check_area" residx="37021717"></div>
      <div class="summary_info">
        <a href="javascript:void(0)">
          <div class="personal_info">
            <span class="name">김OO</span>
            <span class="gender_age">여 27세</span>
            <span class="career_all">경력 5년 3개월</span>
          </div>
          <div class="career_item">
            <ul class="career_list">
              <li class="now">
                <span class="company_info"><span>A사</span></span>
                <span class="year_data"><em class="career_now">재직중</em></span>
                <div class="point_txt"><em class="highlight">마케팅</em></div>
              </li>
              <li>
                <span class="company_info"><span>B사</span></span>
                <span class="year_data">(11개월)</span>
              </li>
            </ul>
          </div>
          <div class="education_item">영산대학교(부산) 웹툰영화학과(졸업)</div>
          <div class="list_jobs_skill">
            <span class="item jobs">영상편집</span>
            <span class="item jobs">유튜브</span>
          </div>
        </a>
      </div>
      <div class="wrap_tag_item">
        <ul class="tag_item_list">
          <li><div class="TipBox"><div class="TipCont"><div class="TipTxt">적극 구직 중인 후보자 입니다.</div></div></div></li>
        </ul>
      </div>
      <div class="talent_list_data">
        <button class="btn_block"></button>
        <p>26-06-10 업데이트</p>
      </div>
    </div>
  `);
  const result = parseCandidateCard(card);
  assert.equal(result.maskedName, '김OO');
  assert.equal(result.gender, '여');
  assert.equal(result.age, 27);
  assert.equal(result.careerSummary, '경력 5년 3개월');
  assert.deepEqual(result.recentPositions, [
    { company: 'A사', period: '재직중', note: '마케팅' },
    { company: 'B사', period: '(11개월)', note: '' }
  ]);
  assert.equal(result.education, '영산대학교(부산) 웹툰영화학과(졸업)');
  assert.deepEqual(result.tags, ['영상편집', '유튜브']);
  assert.deepEqual(result.badges, ['적극 구직 중인 후보자 입니다.']);
  assert.equal(result.lastUpdatedLabel, '26-06-10 업데이트');
  assert.equal(result.sourceUrl, 'https://hiring.saramin.co.kr/applicant-view/position/resume/37021717');
});

test('parseCandidateCard: 필드가 없으면 null/빈 배열로 채운다(추측하지 않음)', () => {
  const card = cardFromHtml('<div class="talent_list_item"></div>');
  const result = parseCandidateCard(card);
  assert.equal(result.maskedName, null);
  assert.equal(result.gender, null);
  assert.equal(result.age, null);
  assert.deepEqual(result.recentPositions, []);
  assert.deepEqual(result.tags, []);
  assert.deepEqual(result.badges, []);
  assert.equal(result.sourceUrl, null);
});

test('parseCandidateCard: gender_age 텍스트에서 성별과 나이를 각각 뽑아낸다', () => {
  const card = cardFromHtml(`
    <div class="talent_list_item">
      <div class="summary_info"><span class="gender_age">남 33세</span></div>
    </div>
  `);
  const result = parseCandidateCard(card);
  assert.equal(result.gender, '남');
  assert.equal(result.age, 33);
});

test('parseCandidateCard: residx 없으면 sourceUrl은 null', () => {
  const card = cardFromHtml('<div class="talent_list_item"><div class="check_area"></div></div>');
  assert.equal(parseCandidateCard(card).sourceUrl, null);
});

// 2026-08-28 실제 사람인 인재풀 검색결과 화면에서 로그인해서 직접
// 확인한 실제 페이지네이션 구조(.PageBox 안에 .BtnPrev/.BtnNext) --
// 클릭해서 실제로 1페이지→2페이지로 넘어가는 것까지 확인함.
test('findNextPageButton: .PageBox .BtnNext를 우선 찾는다', () => {
  const dom = new JSDOM(`
    <div class="talent_list">
      <div class="PageBox">
        <button class="BtnType SizeS BtnPrev">이전</button>
        <a href="#" class="on">1</a>
        <a href="#">2</a>
        <button class="BtnType SizeS BtnNext">다음</button>
      </div>
    </div>
  `);
  const btn = findNextPageButton(dom.window.document);
  assert.equal(btn.className, 'BtnType SizeS BtnNext');
});

// 실사용 확인 중 실제로 발견한 오탐 사례: 검색결과 화면 위쪽의 "스페셜
// 태그" 캐러셀 다음 버튼(#special_tag_next_btn)도 접근성 텍스트가
// 똑같이 "다음"이고, DOM 순서상 페이지네이션보다 앞에 나온다.
// .PageBox 범위로 좁혀서 이 버튼을 절대 집지 않아야 한다.
test('findNextPageButton: 스페셜 태그 캐러셀의 "다음" 버튼은 무시한다', () => {
  const dom = new JSDOM(`
    <div>
      <div class="special_tag_wrap">
        <div class="swiper special_tag_swiper">
          <button id="special_tag_next_btn" aria-disabled="false">다음</button>
        </div>
      </div>
      <div class="talent_list">
        <div class="PageBox">
          <button class="BtnType SizeS BtnNext">다음</button>
        </div>
      </div>
    </div>
  `);
  const btn = findNextPageButton(dom.window.document);
  assert.notEqual(btn.id, 'special_tag_next_btn');
  assert.equal(btn.className, 'BtnType SizeS BtnNext');
});

test('findNextPageButton: .PageBox가 없으면 텍스트 폴백으로 찾되 캐러셀은 제외한다', () => {
  const dom = new JSDOM(`
    <div>
      <div class="special_tag_wrap"><button id="special_tag_next_btn">다음</button></div>
      <div class="paging"><a class="btn_next">다음</a></div>
    </div>
  `);
  const btn = findNextPageButton(dom.window.document);
  assert.equal(btn.className, 'btn_next');
});

test('findNextPageButton: 비활성화된 .PageBox .BtnNext는 무시하고 폴백도 없으면 null', () => {
  const dom = new JSDOM(`
    <div class="PageBox"><button class="BtnType SizeS BtnNext disabled" disabled>다음</button></div>
  `);
  assert.equal(findNextPageButton(dom.window.document), null);
});

test('findNextPageButton: 아무것도 없으면 null', () => {
  const dom = new JSDOM('<div class="PageBox"></div>');
  assert.equal(findNextPageButton(dom.window.document), null);
});

test('findNextPageButton: 없으면 null', () => {
  const dom = new JSDOM('<div class="paging"><a class="btn_prev">이전</a></div>');
  assert.equal(findNextPageButton(dom.window.document), null);
});

// 2026-09-02 실사용 확인: 사람인 검색창은 `input` 이벤트를 받으면 그
// 즉시 값을 빈 문자열로 되돌린다(자동완성 컴포넌트로 추정) -- 그래서
// `input` 대신 `keyup`+`change`를 쏜다. 이 테스트는 그 두 이벤트가
// 실제로 발생하는지, 그리고 (input 이벤트를 등록해도) 최종 값이
// 되돌아가지 않고 유지되는지를 함께 확인한다.
test('setNativeInputValue: 값을 설정하고 keyup+change 이벤트를 발생시킨다(input은 쏘지 않음)', () => {
  const dom = new JSDOM('<input>');
  const input = dom.window.document.querySelector('input');
  let keyupFired = false;
  let changeValue = null;
  let inputFired = false;
  input.addEventListener('keyup', () => { keyupFired = true; });
  input.addEventListener('change', () => { changeValue = input.value; });
  input.addEventListener('input', () => { inputFired = true; });
  setNativeInputValue(input, '영상편집');
  assert.equal(input.value, '영상편집');
  assert.equal(keyupFired, true);
  assert.equal(changeValue, '영상편집');
  assert.equal(inputFired, false);
});

// 2026-08-31 실제 인재풀 검색결과 화면에서 로그인해서 직접 확인한
// 실제 구조 -- 세 칸 모두 placeholder/name/id가 없고 동일한 class
// (search_input result)를 공유해서, 부모 컨테이너의 class로만
// 구분된다.
test('findSearchInputs: 컨테이너 class로 OR/AND/NOT 3칸을 찾는다', () => {
  const dom = new JSDOM(`
    <div class="search_form_wrap">
      <div class="search_default"><input class="search_input result"></div>
      <div class="search_word_include"><input class="search_input result" value="인플루언서, 시딩"></div>
      <div class="search_word_except"><input class="search_input result"></div>
    </div>
  `);
  const inputs = findSearchInputs(dom.window.document);
  assert.ok(inputs.or);
  assert.equal(inputs.and.value, '인플루언서, 시딩');
  assert.ok(inputs.not);
});

test('findSearchInputs: 컨테이너가 없으면 null', () => {
  const dom = new JSDOM('<div></div>');
  const inputs = findSearchInputs(dom.window.document);
  assert.equal(inputs.or, null);
  assert.equal(inputs.and, null);
  assert.equal(inputs.not, null);
});

test('findSearchButton: 텍스트가 정확히 "검색"인 버튼을 찾는다', () => {
  const dom = new JSDOM('<div><button>필터 초기화</button><button>검색</button></div>');
  const btn = findSearchButton(dom.window.document);
  assert.equal(btn.textContent, '검색');
});

test('findSearchButton: 없으면 null', () => {
  const dom = new JSDOM('<div><button>다른 버튼</button></div>');
  assert.equal(findSearchButton(dom.window.document), null);
});

// findNextPageButton이 "다음" 텍스트 전역 매칭으로 스페셜 태그 캐러셀의
// 동명 버튼을 잘못 집었던 전례와 같은 종류의 오탐을 막기 위한 배제 --
// findSearchButton도 아직 실제 컨테이너로 못 좁혀서, 이미 알려진 오탐
// 유발 영역만이라도 제외한다.
test('findSearchButton: 캐러셀 안의 동명 버튼은 무시한다', () => {
  const dom = new JSDOM(`
    <div>
      <div class="special_tag_wrap"><button>검색</button></div>
      <div class="search_filter"><button>검색</button></div>
    </div>
  `);
  const btn = findSearchButton(dom.window.document);
  assert.equal(btn.parentElement.className, 'search_filter');
});

test('findSearchButton: 비활성화된 버튼은 무시한다', () => {
  const dom = new JSDOM('<div><button disabled>검색</button></div>');
  assert.equal(findSearchButton(dom.window.document), null);
});

test('findSearchButton: containerSelector를 주면 그 범위 안에서만 찾는다', () => {
  const dom = new JSDOM(`
    <div>
      <div class="outside"><button>검색</button></div>
      <div class="inside_box"><button>검색</button></div>
    </div>
  `);
  const btn = findSearchButton(dom.window.document, '.inside_box');
  assert.equal(btn.parentElement.className, 'inside_box');
});

// 2026-08-31 실제 확인: 컨테이너 인자를 안 줘도 기본으로
// .search_form_wrap 범위 안에서 찾는다(그 화면엔 "검색" 버튼이 이
// 하나뿐인 것까지 실사용 확인했지만, 방어적으로 스코프를 유지한다).
test('findSearchButton: 인자 없이도 기본으로 .search_form_wrap 범위 안에서 찾는다', () => {
  const dom = new JSDOM(`
    <div>
      <div class="outside"><button>검색</button></div>
      <div class="search_form_wrap"><button class="search_submit">검색</button></div>
    </div>
  `);
  const btn = findSearchButton(dom.window.document);
  assert.equal(btn.className, 'search_submit');
});

// 2026-09-02 실사용 확인: 정렬 토글(추천순/업데이트일순)과 "업데이트
// N일/개월 이내" 필터 select는 칩 입력과 달리 합성 이벤트만으로도
// 실제 검색을 다시 발생시켰다 -- chrome.debugger가 필요 없다.
test('findSortButton: label과 정확히 일치하는 버튼을 찾는다', () => {
  const dom = new JSDOM('<div><button class="active">추천순</button><button class="sort_item_update">업데이트일순</button></div>');
  const btn = findSortButton(dom.window.document, '업데이트일순');
  assert.equal(btn.className, 'sort_item_update');
});

test('findSortButton: 없으면 null', () => {
  const dom = new JSDOM('<div><button>추천순</button></div>');
  assert.equal(findSortButton(dom.window.document, '업데이트일순'), null);
});

test('findUpdateFreshnessSelect: 옵션에 "이내"가 포함된 select를 찾는다', () => {
  const dom = new JSDOM(`
    <div>
      <select name="career_min"><option>선택</option><option>1년 이상</option></select>
      <select><option value="3day">업데이트 3일 이내</option><option value="6month">업데이트 6개월 이내</option></select>
    </div>
  `);
  const sel = findUpdateFreshnessSelect(dom.window.document);
  assert.equal(sel.options[1].value, '6month');
});

test('findUpdateFreshnessSelect: 없으면 null', () => {
  const dom = new JSDOM('<div><select name="career_min"><option>선택</option></select></div>');
  assert.equal(findUpdateFreshnessSelect(dom.window.document), null);
});

test('setNativeSelectValue: 값을 설정하고 change 이벤트를 발생시킨다', () => {
  const dom = new JSDOM('<select><option value="3day">3일</option><option value="6month">6개월</option></select>');
  const sel = dom.window.document.querySelector('select');
  let changeValue = null;
  sel.addEventListener('change', () => { changeValue = sel.value; });
  setNativeSelectValue(sel, '6month');
  assert.equal(sel.value, '6month');
  assert.equal(changeValue, '6month');
});

test('findEducationCheckboxLabel: 텍스트가 정확히 일치하는 label을 찾는다', () => {
  const dom = new JSDOM(`
    <span class="Chk"><input type="checkbox" id="edu_8"><label for="edu_8">대학(4년)</label></span>
    <span class="Chk"><input type="checkbox" id="edu_16"><label for="edu_16">석사</label></span>
  `);
  const label = findEducationCheckboxLabel(dom.window.document, '대학(4년)');
  assert.equal(label.getAttribute('for'), 'edu_8');
});

test('findEducationCheckboxLabel: 없으면 null', () => {
  const dom = new JSDOM('<span class="Chk"><label for="edu_1">고등학교</label></span>');
  assert.equal(findEducationCheckboxLabel(dom.window.document, '박사'), null);
});
