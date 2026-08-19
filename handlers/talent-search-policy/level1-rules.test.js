import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLevel1Rules } from './level1-rules.js';

const VALID = {
  resumeUpdated: { passWithinDays: 90, verifyWithinDays: 180 },
  shortTenure: { monthsThreshold: 12, lookbackYears: 5, countThreshold: 2, exceptions: ['인턴'] },
  careerGap: { ignoreUnderMonths: 6, verifyUnderMonths: 12 }
};

test('validateLevel1Rules: 올바른 값이면 null', () => {
  assert.equal(validateLevel1Rules(VALID), null);
});

test('validateLevel1Rules: resumeUpdated 필드가 정수가 아니면 에러', () => {
  const bad = { ...VALID, resumeUpdated: { passWithinDays: 0, verifyWithinDays: 180 } };
  assert.ok(validateLevel1Rules(bad));
});

test('validateLevel1Rules: exceptions가 빈 배열이면 에러', () => {
  const bad = { ...VALID, shortTenure: { ...VALID.shortTenure, exceptions: [] } };
  assert.ok(validateLevel1Rules(bad));
});

test('validateLevel1Rules: careerGap 필드 누락이면 에러', () => {
  const bad = { ...VALID, careerGap: undefined };
  assert.ok(validateLevel1Rules(bad));
});
