import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResumeAgeDays, parseCareerYears, evaluateListCandidate } from './talentSearchListFilter.js';

const LABEL = '26-06-10 업데이트';
const PARSED_MS = Date.UTC(2026, 5, 10); // 2026-06-10 UTC

test('parseResumeAgeDays: 정확히 180일 후', () => {
  assert.equal(parseResumeAgeDays(LABEL, new Date(PARSED_MS + 180 * 86400000)), 180);
});

test('parseResumeAgeDays: 181일 후', () => {
  assert.equal(parseResumeAgeDays(LABEL, new Date(PARSED_MS + 181 * 86400000)), 181);
});

test('parseResumeAgeDays: 형식이 안 맞으면 null', () => {
  assert.equal(parseResumeAgeDays('3일 전', new Date()), null);
  assert.equal(parseResumeAgeDays(null, new Date()), null);
  assert.equal(parseResumeAgeDays(undefined, new Date()), null);
});

test('parseResumeAgeDays: 미래 날짜는 0으로 clamp', () => {
  assert.equal(parseResumeAgeDays(LABEL, new Date(PARSED_MS - 86400000)), 0);
});

test('parseCareerYears: "경력 5년 3개월"', () => {
  assert.equal(parseCareerYears('경력 5년 3개월'), 5 + 3 / 12);
});

test('parseCareerYears: "신입"은 0년', () => {
  assert.equal(parseCareerYears('신입'), 0);
});

test('parseCareerYears: 개월만 있는 경우', () => {
  assert.equal(parseCareerYears('경력 8개월'), 8 / 12);
});

test('parseCareerYears: 형식이 안 맞으면 null', () => {
  assert.equal(parseCareerYears('경력무관'), null);
  assert.equal(parseCareerYears(null), null);
});

test('evaluateListCandidate: 둘 다 통과', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 5년' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 3, experienceMaxYears: 7 };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});

test('evaluateListCandidate: 이력서 업데이트만 걸림', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 5년' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 3, experienceMaxYears: 7 };
  const refDate = new Date(PARSED_MS + 181 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: true, reasons: ['resumeStale'] });
});

test('evaluateListCandidate: 경력연수만 걸림 (최소 미달, 여유분 밖)', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 4년 4개월' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: true, reasons: ['careerOutOfRange'] });
});

test('evaluateListCandidate: 경력연수가 여유분 안이면 통과', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 4년 7개월' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});

test('evaluateListCandidate: 둘 다 걸림', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '신입' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 200 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: true, reasons: ['resumeStale', 'careerOutOfRange'] });
});

test('evaluateListCandidate: 판단 불가는 통과', () => {
  const candidate = { lastUpdatedLabel: null, careerSummary: null };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: 5, experienceMaxYears: 10 };
  assert.deepEqual(evaluateListCandidate(candidate, config, new Date()), { skip: false, reasons: [] });
});

test('evaluateListCandidate: level1Rules가 null이면 이력서 기준은 건너뜀', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '경력 5년' };
  const config = { level1Rules: null, experienceMinYears: null, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 300 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});

test('evaluateListCandidate: 프로젝트가 min/max 둘 다 null이면 경력 기준 자체를 안 씀', () => {
  const candidate = { lastUpdatedLabel: LABEL, careerSummary: '신입' };
  const config = { level1Rules: { resumeUpdated: { verifyWithinDays: 180 } }, experienceMinYears: null, experienceMaxYears: null };
  const refDate = new Date(PARSED_MS + 10 * 86400000);
  assert.deepEqual(evaluateListCandidate(candidate, config, refDate), { skip: false, reasons: [] });
});
