import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTalentSearchProjectInput, validateJobTemplateInput, TALENT_SEARCH_PLATFORMS, TALENT_SEARCH_EDUCATION_LEVELS } from './talentSearchProjectValidate.js';

const VALID = {
  title: '2026년 8월 리빙MD 채용',
  roleTitle: '리빙상품 기획MD',
  employmentType: '정규직',
  headcount: 1,
  targetRecommendCount: 30,
  platforms: ['사람인', '원티드'],
  keywords: { include: ['MD'], or: [], exact: [], exclude: [], preferred: [] }
};

test('validateTalentSearchProjectInput: 올바른 값이면 null', () => {
  assert.equal(validateTalentSearchProjectInput(VALID), null);
});

test('validateTalentSearchProjectInput: title이 없으면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, title: '' }));
});

test('validateTalentSearchProjectInput: targetRecommendCount가 소수면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, targetRecommendCount: 1.5 }));
});

test('validateTalentSearchProjectInput: platforms가 빈 배열이면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, platforms: [] }));
});

test('validateTalentSearchProjectInput: 허용 안 된 플랫폼이면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, platforms: ['링크드인'] }));
});

test('validateTalentSearchProjectInput: keywords 항목이 배열이 아니면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, keywords: { ...VALID.keywords, include: 'MD' } }));
});

test('validateTalentSearchProjectInput: keywords를 아예 안 보내도 통과 (선택)', () => {
  const { keywords, ...rest } = VALID;
  assert.equal(validateTalentSearchProjectInput(rest), null);
});

test('validateTalentSearchProjectInput: clarificationNotes 형식이 틀리면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, clarificationNotes: [{ question: '질문' }] }));
});

test('TALENT_SEARCH_PLATFORMS: 4개 플랫폼', () => {
  assert.deepEqual(TALENT_SEARCH_PLATFORMS, ['사람인', '잡코리아', '리멤버', '원티드']);
});

test('validateTalentSearchProjectInput: locationDistricts가 문자열 배열이면 통과', () => {
  assert.equal(validateTalentSearchProjectInput({ ...VALID, locationDistricts: ['영등포구', '마포구'] }), null);
});

test('validateTalentSearchProjectInput: locationDistricts가 배열이 아니면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, locationDistricts: '영등포구' }));
});

test('validateTalentSearchProjectInput: educationLevels가 허용된 값이면 통과', () => {
  assert.equal(validateTalentSearchProjectInput({ ...VALID, educationLevels: ['대학(4년)', '석사'] }), null);
});

test('validateTalentSearchProjectInput: educationLevels에 허용 안 된 값이 있으면 에러', () => {
  assert.ok(validateTalentSearchProjectInput({ ...VALID, educationLevels: ['초등학교'] }));
});

test('TALENT_SEARCH_EDUCATION_LEVELS: 5개 고정값', () => {
  assert.deepEqual(TALENT_SEARCH_EDUCATION_LEVELS, ['고등학교', '대학(2,3년)', '대학(4년)', '석사', '박사']);
});

test('validateJobTemplateInput: 올바른 값이면 null', () => {
  assert.equal(validateJobTemplateInput({ name: '리빙MD 템플릿', criteria: { roleTitle: '리빙MD' } }), null);
});

test('validateJobTemplateInput: name이 없으면 에러', () => {
  assert.ok(validateJobTemplateInput({ name: '', criteria: {} }));
});

test('validateJobTemplateInput: criteria가 배열이면 에러', () => {
  assert.ok(validateJobTemplateInput({ name: '템플릿', criteria: [] }));
});
