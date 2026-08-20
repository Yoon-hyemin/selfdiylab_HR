import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvidenceCoefficients } from '../_lib/talentSearchPolicyValidate.js';

const VALID = { none: 0.5, weak: 0.65, partial: 0.8, clear: 1.0 };

test('validateEvidenceCoefficients: 올바른 값이면 null', () => {
  assert.equal(validateEvidenceCoefficients(VALID), null);
});

test('validateEvidenceCoefficients: 0보다 크지 않으면 에러', () => {
  assert.ok(validateEvidenceCoefficients({ ...VALID, none: 0 }));
});

test('validateEvidenceCoefficients: 1보다 크면 에러', () => {
  assert.ok(validateEvidenceCoefficients({ ...VALID, clear: 1.1 }));
});

test('validateEvidenceCoefficients: 순서가 깨지면(약함이 부분보다 큼) 에러', () => {
  assert.ok(validateEvidenceCoefficients({ ...VALID, weak: 0.9 }));
});

test('validateEvidenceCoefficients: 필드가 누락되면 에러', () => {
  assert.ok(validateEvidenceCoefficients({ none: 0.5, weak: 0.65, partial: 0.8 }));
});
