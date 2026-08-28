/**
 * "실제 후보 리스트 가져오기"(사람인 검색결과 리스트) 저장 전 필터.
 * 리스트 카드에 이미 나오는 정보(이력서 최종업데이트일, 경력연수)만으로
 * 명확히 조건 밖인 후보를 판정한다. db.js를 import하지 않아
 * DATABASE_URL 없이 node --test로 검증 가능(talentSearchPolicyValidate.js가
 * 이미 쓰는 패턴과 동일).
 *
 * 판단 불가(날짜/경력 텍스트를 못 읽음)는 항상 "통과"로 취급한다 --
 * 원본 명세 4장의 "확실하지 않은 사람은 성급히 탈락시키지 말라"는 원칙.
 * 이건 이 프로젝트가 다른 곳(크롬 확장 OCR)에서 쓰는 "실패하면 에러로
 * 드러낸다"는 fail-closed 원칙과는 별개다 -- 여기서는 판단 불가가
 * 에러가 아니라 정상적으로 발생하는 입력이다.
 */

// 경력연수 여유분. 반올림·근속 계산 오차로 흔히 생기는 경계값을
// 무리하게 걸러내지 않기 위한 값 -- 정책 편집 화면의 대상이 아니라
// 구현 디테일이라 상수로만 관리한다(설계문서 참고).
const CAREER_YEARS_GRACE = 0.5;

export function parseResumeAgeDays(label, refDate) {
  if (typeof label !== 'string') return null;
  const match = /(\d{2})-(\d{2})-(\d{2})/.exec(label);
  if (!match) return null;
  const [, yy, mm, dd] = match;
  const parsed = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd));
  if (Number.isNaN(parsed)) return null;
  const days = Math.floor((refDate.getTime() - parsed) / 86400000);
  return days < 0 ? 0 : days;
}

export function parseCareerYears(text) {
  if (typeof text !== 'string') return null;
  if (text.includes('신입')) return 0;
  const yearMatch = /(\d+)\s*년/.exec(text);
  const monthMatch = /(\d+)\s*개월/.exec(text);
  if (!yearMatch && !monthMatch) return null;
  const years = yearMatch ? Number(yearMatch[1]) : 0;
  const months = monthMatch ? Number(monthMatch[1]) : 0;
  return years + months / 12;
}

export function evaluateListCandidate(candidate, config, refDate) {
  const reasons = [];

  const resumeAgeDays = parseResumeAgeDays(candidate.lastUpdatedLabel, refDate);
  if (resumeAgeDays !== null && config.level1Rules
      && resumeAgeDays > config.level1Rules.resumeUpdated.verifyWithinDays) {
    reasons.push('resumeStale');
  }

  const careerYears = parseCareerYears(candidate.careerSummary);
  if (careerYears !== null) {
    // Postgres numeric 컬럼은 호출부(예: list-candidates.js)에서 이미
    // Number()로 변환해서 넘기지만, 이 함수 자체가 그 변환에만 기대는
    // 건 위험하다 -- 문자열("5")이 그대로 들어오면 `"5" + 0.5`가 JS의
    // 문자열 이어붙이기로 동작해 비교가 조용히 무력화되는 실사용 버그가
    // 실제로 있었다(handlers/talent-search-projects/[id]/list-candidates.js
    // 코멘트 참고). 순수 함수 스스로도 DB에서 오는 문자열 입력을 정직하게
    // 받아들이도록 여기서도 방어적으로 다시 변환한다.
    const experienceMinYears = config.experienceMinYears == null ? null : Number(config.experienceMinYears);
    const experienceMaxYears = config.experienceMaxYears == null ? null : Number(config.experienceMaxYears);
    if (experienceMinYears != null && careerYears < experienceMinYears - CAREER_YEARS_GRACE) {
      reasons.push('careerOutOfRange');
    } else if (experienceMaxYears != null && careerYears > experienceMaxYears + CAREER_YEARS_GRACE) {
      reasons.push('careerOutOfRange');
    }
  }

  return { skip: reasons.length > 0, reasons };
}
