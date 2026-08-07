/**
 * handlers/_lib/goalPeriod.js
 *
 * 2026-08-07: 기업 목표를 "매달 새로 만드는 것"에서 "기간형 목표(월간/분기/
 * 반기/연간/직접설정) + 월별 진행기록"으로 확장하면서 필요해진 기간 계산
 * 유틸. 기존 월별 기업 목표(period_type/start_date/end_date가 전부 NULL인
 * 행 — sql/011 이전에 만들어진 행 전부)는 자기 month 컬럼 기준 "그 달 1일
 * ~ 말일"을 기간으로 취급한다 — 그래야 기존 데이터를 지우거나 이관하지
 * 않고도 새 겹침 기준 조회/검증 로직과 그대로 맞물린다.
 *
 * index.html에도 같은 로직을 그대로 복제해뒀다(프론트는 이 파일을 import할
 * 수 없는 순수 <script> 태그라서) — 이 프로젝트가 이미 monthWindow.js의
 * isEditableMonth()를 index.html의 thisMonthKey()와 별도로 복제해서 쓰는
 * 것과 같은 관례다. 로직을 바꾸면 두 곳 다 고쳐야 한다.
 */

// 'YYYY-MM' -> 그 달의 { start:'YYYY-MM-DD', end:'YYYY-MM-DD' }
export function monthRange(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

// okrs row -> { start, end } (date 문자열). period_type/start_date/end_date가
// 있으면 그대로 쓰고, 없으면(기존 월별 행) month 컬럼에서 파생시킨다.
export function deriveGoalPeriod(okr) {
  if (okr.start_date && okr.end_date) {
    const toStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
    return { start: toStr(okr.start_date), end: toStr(okr.end_date) };
  }
  return monthRange(okr.month);
}

export function periodsOverlap(a, b) {
  return a.start <= b.end && b.start <= a.end;
}

export function monthOverlapsGoal(monthKey, okr) {
  return periodsOverlap(monthRange(monthKey), deriveGoalPeriod(okr));
}

// 'YYYY-MM' -> n개월 뒤(음수면 이전)의 'YYYY-MM'
function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// 2026-08-07(기간 수정 허용): 회사 목표는 okrs.month가 "생성 시점의 시작월"로
// 고정돼 있어서, isEditableMonth(okr.month)를 그대로 쓰면 반기/연간처럼 여러
// 달짜리 목표가 생성 후 2달만 지나면(이번달/지난달 규칙) 영구히 수정·삭제가
// 잠긴다 — 정작 "기간이 긴 목표일수록 나중에 기간을 고칠 일이 많다"는 요청과
// 정면으로 부딪힌다. 그래서 회사 목표만 "목표 기간이 아직 안 끝났거나, 끝난 지
// 한 달 이내"면 수정 가능하게 별도 기준을 둔다(끝난 달 기준 1개월 유예는
// 기존 이번달/지난달 여유분 관례와 동일한 폭).
export function isCompanyGoalEditableNow(okr, nowMonthKey) {
  const period = deriveGoalPeriod(okr);
  const endMonth = period.end.slice(0, 7);
  return nowMonthKey <= addMonths(endMonth, 1);
}
