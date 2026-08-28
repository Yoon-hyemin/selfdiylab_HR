import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateListCandidateBatch } from './talentSearchListCandidateValidate.js';

const validCandidate = {
  maskedName: '김OO',
  sourceUrl: 'https://hiring.saramin.co.kr/applicant-view/position/resume/123',
  age: 27,
  recentPositions: [{ company: 'A사', period: '2년', note: '' }],
  tags: ['영상편집'],
  badges: ['적극 구직중']
};

test('platform 없으면 거부', () => {
  assert.equal(validateListCandidateBatch({ candidates: [validCandidate] }), '플랫폼을 지정해주세요');
});

test('candidates가 빈 배열이면 거부', () => {
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [] }), '가져올 후보가 1명 이상 있어야 해요');
});

test('maskedName 없으면 거부', () => {
  const bad = { ...validCandidate, maskedName: '' };
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [bad] }), '후보 이름이 올바르지 않아요');
});

test('sourceUrl 없으면 거부', () => {
  const bad = { ...validCandidate };
  delete bad.sourceUrl;
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [bad] }), '후보 원문 링크가 올바르지 않아요');
});

test('age가 숫자가 아니면 거부', () => {
  const bad = { ...validCandidate, age: '스물일곱' };
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [bad] }), '나이는 숫자여야 해요');
});

test('sourceUrl이 http(s)가 아니면 거부 (XSS 방지)', () => {
  const bad = { ...validCandidate, sourceUrl: 'javascript:alert(1)' };
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [bad] }), '후보 원문 링크가 올바르지 않아요');
});

test('후보가 200명 초과면 거부', () => {
  const many = Array.from({ length: 201 }, (_, i) => ({ ...validCandidate, maskedName: `후보${i}` }));
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: many }), '한 번에 너무 많은 후보를 가져올 수 없어요');
});

test('후보가 정확히 200명이면 통과', () => {
  const exactly200 = Array.from({ length: 200 }, (_, i) => ({ ...validCandidate, maskedName: `후보${i}` }));
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: exactly200 }), null);
});

test('정상 입력이면 통과(null)', () => {
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [validCandidate] }), null);
});

test('age/recentPositions/tags/badges는 선택값 -- 없어도 통과', () => {
  const minimal = { maskedName: '김OO', sourceUrl: 'https://x.com/1' };
  assert.equal(validateListCandidateBatch({ platform: '사람인', candidates: [minimal] }), null);
});
