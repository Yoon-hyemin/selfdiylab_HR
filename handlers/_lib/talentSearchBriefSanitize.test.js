import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeParsedBrief } from './talentSearchBriefSanitize.js';
import { normalizeRegion } from './talentSearchRegions.js';

const BRIEF = '대구(수성구·달서구·북구)에서 일할 경력 1년 이상 영상PD. 촬영과 편집은 꼭 할 줄 알아야 하고, AI 영상툴이나 After Effects, 커머스 경험이 있으면 우대. 최근 6개월 이상 경력 공백은 제외.';

test('sanitizeParsedBrief: 정상 응답은 그대로 통과', () => {
  const out = sanitizeParsedBrief({
    roleTitle: '영상PD', region: '대구', districts: ['수성구', '달서구', '북구'],
    experienceMinYears: 1, experienceMaxYears: null,
    must: [{ label: '촬영', synonyms: ['영상촬영'] }, { label: '편집', synonyms: ['영상편집'] }],
    nice: [{ label: 'After Effects', synonyms: ['에펙', 'AE'] }],
    avoidKeywords: [], avoidConditions: ['최근 6개월 이상 경력 공백'], exact: [], educationLevels: [],
    spans: [{ text: '대구(수성구·달서구·북구)', type: '지역' }, { text: '경력 1년 이상', type: '경력' }]
  }, BRIEF);
  assert.equal(out.region, '대구');
  assert.deepEqual(out.districts, ['수성구', '달서구', '북구']);
  assert.equal(out.experienceMinYears, 1);
  assert.equal(out.must.length, 2);
  assert.deepEqual(out.avoidConditions, ['최근 6개월 이상 경력 공백']);
  assert.equal(out.spans.length, 2);
});

test('sanitizeParsedBrief: 빈 응답이어도 모든 필드가 빈 값으로 나온다', () => {
  const out = sanitizeParsedBrief(null, BRIEF);
  assert.deepEqual(out, {
    roleTitle: '', region: null, districts: [], experienceMinYears: null, experienceMaxYears: null,
    must: [], nice: [], avoidKeywords: [], avoidConditions: [], exact: [], educationLevels: [], spans: []
  });
});

test('sanitizeParsedBrief: 그 시/도에 없는 구 이름은 버린다', () => {
  const out = sanitizeParsedBrief({ region: '대구광역시', districts: ['수성구', '강남구', '수성'] }, BRIEF);
  assert.equal(out.region, '대구');
  assert.deepEqual(out.districts, ['수성구']);
});

test('sanitizeParsedBrief: "전체"는 <시/도>전체 하나로 바꾼다', () => {
  const out = sanitizeParsedBrief({ region: '서울', districts: ['전체', '마포구'] }, '');
  assert.deepEqual(out.districts, ['서울전체']);
});

test('sanitizeParsedBrief: 시/도를 모르면 구도 버린다', () => {
  const out = sanitizeParsedBrief({ region: '화성', districts: ['수성구'] }, '');
  assert.equal(out.region, null);
  assert.deepEqual(out.districts, []);
});

test('sanitizeParsedBrief: 원문에 없는 span과 모르는 type은 버린다', () => {
  const out = sanitizeParsedBrief({ spans: [
    { text: '영상PD', type: '직무' }, { text: '없는 문장', type: '필수' }, { text: '촬영', type: '기타' }
  ] }, BRIEF);
  assert.deepEqual(out.spans, [{ text: '영상PD', type: '직무' }]);
});

test('sanitizeParsedBrief: 허용 안 된 학력은 버린다', () => {
  const out = sanitizeParsedBrief({ educationLevels: ['대학(4년)', '초등학교'] }, '');
  assert.deepEqual(out.educationLevels, ['대학(4년)']);
});

test('sanitizeParsedBrief: 필수/우대에 같은 라벨이 겹치면 필수만 남고, 비슷한 말에서 라벨 자신은 뺀다', () => {
  const out = sanitizeParsedBrief({
    must: [{ label: ' 편집 ', synonyms: ['편집', '영상편집', '영상편집', ''] }],
    nice: [{ label: '편집', synonyms: [] }, { label: '커머스' }]
  }, '');
  assert.deepEqual(out.must, [{ label: '편집', synonyms: ['영상편집'] }]);
  assert.deepEqual(out.nice, [{ label: '커머스', synonyms: [] }]);
});

test('sanitizeParsedBrief: 경력 최대가 최소보다 작거나 음수면 버린다', () => {
  const out = sanitizeParsedBrief({ experienceMinYears: 5, experienceMaxYears: 3 }, '');
  assert.equal(out.experienceMinYears, 5);
  assert.equal(out.experienceMaxYears, null);
  assert.equal(sanitizeParsedBrief({ experienceMinYears: -1 }, '').experienceMinYears, null);
});

test('normalizeRegion: 흔한 표기를 사람인 시/도 키로 바꾼다', () => {
  assert.equal(normalizeRegion('광주'), '전남광주');
  assert.equal(normalizeRegion('경기도'), '경기');
  assert.equal(normalizeRegion('서울'), '서울');
  assert.equal(normalizeRegion('없는곳'), null);
});
