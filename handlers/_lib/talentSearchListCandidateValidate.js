/**
 * POST .../list-candidates 요청 바디 검증. db.js를 import하지 않아서
 * DATABASE_URL 없이도 node --test가 돈다(이 프로젝트가 1B-3부터
 * 정착시킨 패턴).
 */
export function validateListCandidateBatch(body) {
  if (!body || typeof body.platform !== 'string' || !body.platform.trim()) {
    return '플랫폼을 지정해주세요';
  }
  if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
    return '가져올 후보가 1명 이상 있어야 해요';
  }
  for (const c of body.candidates) {
    if (!c || typeof c.maskedName !== 'string' || !c.maskedName.trim()) {
      return '후보 이름이 올바르지 않아요';
    }
    if (typeof c.sourceUrl !== 'string' || !c.sourceUrl.trim()) {
      return '후보 원문 링크가 올바르지 않아요';
    }
    if (c.age !== undefined && c.age !== null && !Number.isInteger(c.age)) {
      return '나이는 숫자여야 해요';
    }
    if (c.recentPositions !== undefined && !Array.isArray(c.recentPositions)) {
      return '경력 정보 형식이 올바르지 않아요';
    }
    if (c.tags !== undefined && !Array.isArray(c.tags)) {
      return '태그 형식이 올바르지 않아요';
    }
    if (c.badges !== undefined && !Array.isArray(c.badges)) {
      return '배지 형식이 올바르지 않아요';
    }
  }
  return null;
}
