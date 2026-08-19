import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCommonFitWeights } from './common-fit-weights.js';

test('validateCommonFitWeights: 합계 40이면 null', () => {
  const items = [
    { key: 'a', label: '항목A', points: 20 },
    { key: 'b', label: '항목B', points: 20 }
  ];
  assert.equal(validateCommonFitWeights(items), null);
});

test('validateCommonFitWeights: 항목 1개여도 합계만 40이면 통과 (개수 제한 없음)', () => {
  assert.equal(validateCommonFitWeights([{ key: 'only', label: '단일 항목', points: 40 }]), null);
});

test('validateCommonFitWeights: 합계가 40이 아니면 에러', () => {
  const items = [{ key: 'a', label: '항목A', points: 39 }];
  assert.ok(validateCommonFitWeights(items));
});

test('validateCommonFitWeights: 빈 배열이면 에러', () => {
  assert.ok(validateCommonFitWeights([]));
});

test('validateCommonFitWeights: key 중복이면 에러', () => {
  const items = [
    { key: 'dup', label: '항목A', points: 20 },
    { key: 'dup', label: '항목B', points: 20 }
  ];
  assert.ok(validateCommonFitWeights(items));
});

test('validateCommonFitWeights: label이 빈 문자열이면 에러', () => {
  assert.ok(validateCommonFitWeights([{ key: 'a', label: '  ', points: 40 }]));
});

test('validateCommonFitWeights: points가 음수면 에러', () => {
  assert.ok(validateCommonFitWeights([{ key: 'a', label: '항목A', points: -1 }]));
});
