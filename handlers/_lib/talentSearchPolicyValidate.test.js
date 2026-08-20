import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOverrideKeys, POLICY_OVERRIDE_COLUMNS } from './talentSearchPolicyValidate.js';

test('validateOverrideKeys: 알려진 컬럼 키만 있으면 null', () => {
  assert.equal(validateOverrideKeys({ thresholds: {}, daily_recommend_cap_default: 50 }), null);
});

test('validateOverrideKeys: 빈 객체도 통과', () => {
  assert.equal(validateOverrideKeys({}), null);
});

test('validateOverrideKeys: undefined/null도 통과 (overrides 없음)', () => {
  assert.equal(validateOverrideKeys(undefined), null);
  assert.equal(validateOverrideKeys(null), null);
});

test('validateOverrideKeys: 존재하지 않는 컬럼명이면 에러 문자열 반환 (오타 방지)', () => {
  const result = validateOverrideKeys({ daily_recommend_cap_max: 50 });
  assert.ok(result);
  assert.match(result, /daily_recommend_cap_max/);
});

test('validateOverrideKeys: 실제 컬럼 전체가 유효 키로 인식됨', () => {
  const allColumnsOverride = {};
  for (const col of POLICY_OVERRIDE_COLUMNS) allColumnsOverride[col] = null;
  assert.equal(validateOverrideKeys(allColumnsOverride), null);
});
