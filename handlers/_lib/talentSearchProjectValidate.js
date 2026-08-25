/**
 * handlers/_lib/talentSearchProjectValidate.js
 *
 * 인재검색 프로젝트/직무 템플릿 생성 입력값의 순수 검증 로직. DB나 다른
 * 프로젝트 내부 모듈을 import하지 않는다 -- Phase 1B-3에서 검증 로직이
 * db.js를 import하는 핸들러 파일과 같이 있어서 DATABASE_URL 없이는
 * 단위테스트조차 못 돌던 문제를 겪었고, 그때 만든 해결 패턴(순수 검증
 * 전용 파일 분리)을 이번엔 처음부터 따른다.
 */

export const TALENT_SEARCH_PLATFORMS = ['사람인', '잡코리아', '리멤버', '원티드'];

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(s => typeof s === 'string');
}

export function validateTalentSearchProjectInput(body) {
  if (!body || typeof body !== 'object') return '입력값이 올바르지 않아요';
  if (!isNonEmptyString(body.title)) return '검색 프로젝트명을 입력해주세요';
  if (!isNonEmptyString(body.roleTitle)) return '채용 직무/포지션명을 입력해주세요';
  if (!isNonEmptyString(body.employmentType)) return '고용형태를 입력해주세요';
  if (!isPositiveInt(body.headcount)) return '채용인원은 1명 이상의 정수여야 해요';
  if (!isPositiveInt(body.targetRecommendCount)) return '총 적합 추천 목표 인원은 1명 이상의 정수여야 해요';
  if (!Array.isArray(body.platforms) || body.platforms.length === 0) return '검색할 플랫폼을 1개 이상 선택해주세요';
  if (body.platforms.some(p => !TALENT_SEARCH_PLATFORMS.includes(p))) return '지원하지 않는 플랫폼이 포함돼 있어요';

  if (body.keywords !== undefined) {
    if (!body.keywords || typeof body.keywords !== 'object') return '키워드 형식이 올바르지 않아요';
    for (const field of ['include', 'or', 'exact', 'exclude', 'preferred']) {
      if (body.keywords[field] !== undefined && !isStringArray(body.keywords[field])) {
        return '키워드 형식이 올바르지 않아요';
      }
    }
  }

  if (body.clarificationNotes !== undefined) {
    if (!Array.isArray(body.clarificationNotes)) return '추가질문 답변 형식이 올바르지 않아요';
    const ok = body.clarificationNotes.every(
      n => n && typeof n === 'object' && typeof n.question === 'string' && typeof n.answer === 'string'
    );
    if (!ok) return '추가질문 답변 형식이 올바르지 않아요';
  }

  return null;
}

export function validateJobTemplateInput(body) {
  if (!body || typeof body !== 'object') return '입력값이 올바르지 않아요';
  if (!isNonEmptyString(body.name)) return '템플릿 이름을 입력해주세요';
  if (!body.criteria || typeof body.criteria !== 'object' || Array.isArray(body.criteria)) return '템플릿 내용이 올바르지 않아요';
  return null;
}
