// chrome-extension/list-content-lib.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseCandidateCard, findNextPageButton } from './list-content-lib.js';

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

test('findNextPageButton: 활성화된 다음 버튼을 찾는다', () => {
  const dom = new JSDOM('<div class="paging"><a class="btn_prev">이전</a><a class="btn_next">다음</a></div>');
  const btn = findNextPageButton(dom.window.document);
  assert.equal(btn.textContent, '다음');
});

test('findNextPageButton: 비활성화된 버튼은 무시한다', () => {
  const dom = new JSDOM('<div class="paging"><a class="btn_next disabled" aria-disabled="true">다음</a></div>');
  assert.equal(findNextPageButton(dom.window.document), null);
});

test('findNextPageButton: 없으면 null', () => {
  const dom = new JSDOM('<div class="paging"><a class="btn_prev">이전</a></div>');
  assert.equal(findNextPageButton(dom.window.document), null);
});
