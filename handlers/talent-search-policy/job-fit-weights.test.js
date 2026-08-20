import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJobFitDefaultWeights } from '../_lib/talentSearchPolicyValidate.js';

test('validateJobFitDefaultWeights: 합계 60이면 null', () => {
  const items = [
    { key: 'a', label: '핵심경험', points: 40 },
    { key: 'b', label: '우대조건', points: 20 }
  ];
  assert.equal(validateJobFitDefaultWeights(items), null);
});

test('validateJobFitDefaultWeights: 항목 1개여도 합계만 60이면 통과 (개수 제한 없음)', () => {
  assert.equal(validateJobFitDefaultWeights([{ key: 'only', label: '단일 항목', points: 60 }]), null);
});

test('validateJobFitDefaultWeights: 합계가 60이 아니면 에러', () => {
  const items = [{ key: 'a', label: '항목A', points: 59 }];
  assert.ok(validateJobFitDefaultWeights(items));
});

test('validateJobFitDefaultWeights: 빈 배열이면 에러', () => {
  assert.ok(validateJobFitDefaultWeights([]));
});

test('validateJobFitDefaultWeights: key 중복이면 에러', () => {
  const items = [
    { key: 'dup', label: '항목A', points: 30 },
    { key: 'dup', label: '항목B', points: 30 }
  ];
  assert.ok(validateJobFitDefaultWeights(items));
});
