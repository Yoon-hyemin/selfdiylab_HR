import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateThresholdsAndCaps } from '../_lib/talentSearchPolicyValidate.js';

// buildOverrides는 이 파일(thresholds.js)에 있는데, thresholds.js가
// makePolicyPatchHandler(handlers/_lib/talentSearchPolicy.js)를 import하고
// 그게 다시 db.js를 import해서, db.js가 모듈 로드 시점에 DATABASE_URL 부재를
// throw한다 -- 그래서 이 파일만 예외적으로 더미 연결 문자열을 채워준다.
// neon()은 이 시점에 실제 접속을 하지 않고 문자열만 파싱하므로 안전하고,
// 아래 테스트는 buildOverrides(순수 매핑 함수)만 호출할 뿐 sql을 쓰지 않는다.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
const { buildOverrides } = await import('./thresholds.js');

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

test('buildOverrides: 정확히 3개 키(thresholds/기본값/절대상한)로 매핑', () => {
  const body = {
    thresholds: { totalScoreMin: 70, jobFitScoreMin: 42, minMeaningfulEvidenceCount: 2 },
    dailyRecommendCapDefault: 40,
    dailyRecommendCapAbsoluteMax: 55
  };
  const result = buildOverrides(body);
  assert.deepEqual(Object.keys(result).sort(), [
    'daily_recommend_cap_absolute_max',
    'daily_recommend_cap_default',
    'thresholds'
  ]);
  assert.deepEqual(result.thresholds, body.thresholds);
  assert.equal(result.daily_recommend_cap_default, 40);
  assert.equal(result.daily_recommend_cap_absolute_max, 55);
});
