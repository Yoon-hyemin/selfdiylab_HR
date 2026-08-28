// chrome-extension/list-content-lib.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { parseCandidateCard } from './list-content-lib.js';

function cardFromHtml(html) {
  const dom = new JSDOM(`<!DOCTYPE html><div id="root">${html}</div>`);
  return dom.window.document.querySelector('#root > *');
}

test('parseCandidateCard: 필드가 다 있는 카드를 정확히 파싱한다', () => {
  const card = cardFromHtml(`
    <div data-resume-url="https://hiring.saramin.co.kr/applicant-view/position/resume/12345">
      <span data-field="name">김OO</span>
      <span data-field="gender">여</span>
      <span data-field="age">27세</span>
      <span data-field="career-summary">경력 5년 3개월</span>
      <div data-field="position">
        <span data-field="company">A사</span>
        <span data-field="period">11개월</span>
        <span data-field="note">마케팅</span>
      </div>
      <span data-field="education">영산대학교(부산)</span>
      <span data-field="tag">영상편집</span>
      <span data-field="tag">유튜브</span>
      <span data-field="badge">적극 구직중</span>
      <span data-field="updated">26-06-10 업데이트</span>
    </div>
  `);
  const result = parseCandidateCard(card);
  assert.equal(result.maskedName, '김OO');
  assert.equal(result.gender, '여');
  assert.equal(result.age, 27);
  assert.equal(result.careerSummary, '경력 5년 3개월');
  assert.deepEqual(result.recentPositions, [{ company: 'A사', period: '11개월', note: '마케팅' }]);
  assert.equal(result.education, '영산대학교(부산)');
  assert.deepEqual(result.tags, ['영상편집', '유튜브']);
  assert.deepEqual(result.badges, ['적극 구직중']);
  assert.equal(result.lastUpdatedLabel, '26-06-10 업데이트');
  assert.equal(result.sourceUrl, 'https://hiring.saramin.co.kr/applicant-view/position/resume/12345');
});

test('parseCandidateCard: 필드가 없으면 null/빈 배열로 채운다(추측하지 않음)', () => {
  const card = cardFromHtml('<div></div>');
  const result = parseCandidateCard(card);
  assert.equal(result.maskedName, null);
  assert.equal(result.age, null);
  assert.deepEqual(result.recentPositions, []);
  assert.deepEqual(result.tags, []);
  assert.equal(result.sourceUrl, null);
});

test('parseCandidateCard: 나이 텍스트에서 숫자만 뽑아낸다', () => {
  const card = cardFromHtml('<div><span data-field="age">여, 27세</span></div>');
  assert.equal(parseCandidateCard(card).age, 27);
});
