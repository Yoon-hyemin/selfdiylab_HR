/**
 * handlers/_lib/monthWindow.js
 *
 * 목표/체크리스트 생성·수정을 "이번 달 + 지난달"로만 제한하기 위한 공용
 * 월 계산 유틸. 월말이 주말과 겹쳐 그날 체크를 못 하는 경우를 대비해
 * 다음 달로 넘어간 뒤에도 지난달 몫을 정리할 여유를 준다
 * (docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md
 * "월 편집 정책" 참고). UTC 기준으로 계산한다 — 이 프로젝트의 다른 날짜
 * 처리(예: handlers/members/index.js의 기본 입사일)도 전부 UTC 기준이라
 * 그 컨벤션을 따른다.
 */
function pad2(n) { return String(n).padStart(2, '0'); }

export function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function previousMonthKey() {
  const d = new Date();
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  return `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}`;
}

export function isEditableMonth(month) {
  return month === currentMonthKey() || month === previousMonthKey();
}
