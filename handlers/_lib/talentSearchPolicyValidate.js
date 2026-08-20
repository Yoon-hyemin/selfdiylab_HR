/**
 * 인재검색 채점 정책의 각 필드별 검증 함수. DB/HTTP를 import하지 않는
 * 순수 함수만 모아둔다 -- handlers/_lib/db.js는 DATABASE_URL이 없으면
 * 모듈 로드 시점에 throw하므로, 검증 로직을 핸들러 파일 안에 두면
 * DATABASE_URL 없이는 순수 로직 단위테스트조차 돌릴 수 없었다(1B-2까지의
 * 알려진 한계). 이 파일은 그 문제를 해소하기 위해 분리했다.
 */

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isNonNegativeInt(v) {
  return Number.isInteger(v) && v >= 0;
}

export function validateLevel1Rules(l1) {
  if (!l1 || typeof l1 !== 'object') return '값이 올바르지 않아요';
  const ru = l1.resumeUpdated, st = l1.shortTenure, cg = l1.careerGap;
  if (!ru || !isPositiveInt(ru.passWithinDays) || !isPositiveInt(ru.verifyWithinDays)) return '이력서 업데이트 기준이 올바르지 않아요';
  if (!st || !isPositiveInt(st.monthsThreshold) || !isPositiveInt(st.lookbackYears) || !isPositiveInt(st.countThreshold)) return '단기근속 기준이 올바르지 않아요';
  if (!Array.isArray(st.exceptions) || st.exceptions.length === 0 || st.exceptions.some(e => typeof e !== 'string' || !e.trim())) return '단기근속 예외사유가 올바르지 않아요';
  if (!cg || !isPositiveInt(cg.ignoreUnderMonths) || !isPositiveInt(cg.verifyUnderMonths)) return '경력 공백 기준이 올바르지 않아요';
  return null;
}

function validatePointsList(items, expectedSum) {
  if (!Array.isArray(items) || items.length === 0) return '항목이 1개 이상 있어야 해요';
  const seenKeys = new Set();
  let sum = 0;
  for (const item of items) {
    if (!item || typeof item.key !== 'string' || !item.key.trim()) return '항목 key가 올바르지 않아요';
    if (seenKeys.has(item.key)) return '항목 key가 중복돼요';
    seenKeys.add(item.key);
    if (typeof item.label !== 'string' || !item.label.trim()) return '항목 이름을 입력해주세요';
    if (typeof item.points !== 'number' || !Number.isFinite(item.points) || item.points < 0) return '배점은 0 이상의 숫자여야 해요';
    sum += item.points;
  }
  if (sum !== expectedSum) return `배점 합계가 ${expectedSum}점이어야 해요 (지금 합계: ${sum}점)`;
  return null;
}

export function validateCommonFitWeights(items) {
  return validatePointsList(items, 40);
}

export function validateJobFitDefaultWeights(items) {
  return validatePointsList(items, 60);
}

function isFractionInRange(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;
}

export function validateEvidenceCoefficients(ec) {
  if (!ec || typeof ec !== 'object') return '값이 올바르지 않아요';
  const { none, weak, partial, clear } = ec;
  if (![none, weak, partial, clear].every(isFractionInRange)) return '근거수준별 점수는 0보다 크고 100% 이하의 값이어야 해요';
  if (!(none <= weak && weak <= partial && partial <= clear)) return '명확 ≥ 부분 ≥ 약함 ≥ 없음 순서를 지켜야 해요';
  return null;
}

export function validateThresholdsAndCaps(body) {
  const t = body && body.thresholds;
  if (!t || typeof t !== 'object') return '값이 올바르지 않아요';
  if (!isNonNegativeInt(t.totalScoreMin) || t.totalScoreMin > 100) return '총점 기준은 0~100 사이 정수여야 해요';
  if (!isNonNegativeInt(t.jobFitScoreMin) || t.jobFitScoreMin > 60) return '직무점수 기준은 0~60 사이 정수여야 해요';
  if (!isPositiveInt(t.minMeaningfulEvidenceCount)) return '의미있는 근거 개수는 1 이상의 정수여야 해요';
  if (!isPositiveInt(body.dailyRecommendCapDefault)) return '하루 추천상한 기본값은 1 이상의 정수여야 해요';
  if (!isPositiveInt(body.dailyRecommendCapAbsoluteMax)) return '하루 추천상한 절대값은 1 이상의 정수여야 해요';
  if (body.dailyRecommendCapDefault > body.dailyRecommendCapAbsoluteMax) return '하루 추천상한 기본값은 절대상한을 넘을 수 없어요';
  return null;
}
