// chrome-extension/content-lib.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedPage, computeScrollSteps } from './content-lib.js';

test('isBlockedPage: 인증 경로 URL이면 true', () => {
  assert.equal(
    isBlockedPage('https://www.saramin.co.kr/zf_user/company-viewer/certification?redirect_url=x', '아무 제목'),
    true
  );
});

test('isBlockedPage: 제목에 "2단계 인증"이 있으면 true', () => {
  assert.equal(isBlockedPage('https://hiring.saramin.co.kr/x', '2단계 인증 요청 - 사람인'), true);
});

test('isBlockedPage: 제목에 "로그인"이 있으면 true', () => {
  assert.equal(isBlockedPage('https://www.saramin.co.kr/login', '로그인 - 사람인'), true);
});

test('isBlockedPage: 정상 이력서 화면이면 false', () => {
  assert.equal(
    isBlockedPage('https://hiring.saramin.co.kr/applicant-view/position/resume/123', '인재풀 후보자 관리 - 사람인'),
    false
  );
});

test('computeScrollSteps: 콘텐츠가 화면보다 작으면 [0] 하나만', () => {
  assert.deepEqual(computeScrollSteps(500, 1000), [0]);
});

test('computeScrollSteps: 정확히 나눠떨어지는 경우', () => {
  assert.deepEqual(computeScrollSteps(3000, 1000), [0, 1000, 2000]);
});

test('computeScrollSteps: 나눠떨어지지 않는 경우 마지막 스텝은 끝까지', () => {
  assert.deepEqual(computeScrollSteps(2500, 1000), [0, 1000, 1500]);
});

test('computeScrollSteps: 잘못된 입력이면 [0]으로 안전하게 처리', () => {
  assert.deepEqual(computeScrollSteps(NaN, 1000), [0]);
  assert.deepEqual(computeScrollSteps(3000, 0), [0]);
});
