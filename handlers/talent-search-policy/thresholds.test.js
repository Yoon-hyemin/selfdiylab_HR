import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateThresholdsAndCaps } from '../_lib/talentSearchPolicyValidate.js';

const VALID = {
  thresholds: { totalScoreMin: 70, jobFitScoreMin: 42, minMeaningfulEvidenceCount: 2 },
  dailyRecommendCapDefault: 50,
  dailyRecommendCapAbsoluteMax: 50
};

test('validateThresholdsAndCaps: 올바른 값이면 null', () => {
  assert.equal(validateThresholdsAndCaps(VALID), null);
});

test('validateThresholdsAndCaps: totalScoreMin이 100 초과면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, thresholds: { ...VALID.thresholds, totalScoreMin: 101 } }));
});

test('validateThresholdsAndCaps: jobFitScoreMin이 60 초과면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, thresholds: { ...VALID.thresholds, jobFitScoreMin: 61 } }));
});

test('validateThresholdsAndCaps: minMeaningfulEvidenceCount가 0이면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, thresholds: { ...VALID.thresholds, minMeaningfulEvidenceCount: 0 } }));
});

test('validateThresholdsAndCaps: 기본값이 절대상한보다 크면 에러', () => {
  assert.ok(validateThresholdsAndCaps({ ...VALID, dailyRecommendCapDefault: 60, dailyRecommendCapAbsoluteMax: 50 }));
});

test('validateThresholdsAndCaps: 기본값과 절대상한이 같으면 통과', () => {
  assert.equal(validateThresholdsAndCaps({ ...VALID, dailyRecommendCapDefault: 50, dailyRecommendCapAbsoluteMax: 50 }), null);
});
