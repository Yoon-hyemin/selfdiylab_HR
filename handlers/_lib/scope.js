/**
 * handlers/_lib/scope.js
 *
 * 2026-08-11: 평가(evals)/원온원(oneonones)/등급배분(calibration)은 지금까지
 * 로그인 자체가 없어서(성과관리는 "로그인 없이 전사 공개"가 기존 원칙이었다
 * -- handlers/public-data.js 옛 헤더 참고) 아무나 아무 직원의 평가를
 * 만들거나 지울 수 있었다. 개인 계정 로그인 도입으로 이 세 영역은 "본인
 * 또는 그 사람의 부서장/관리자만" 접근하도록 실제로 좁힌다 -- 목표(OKR)의
 * 회사/부서 레벨은 기존처럼 로그인한 사람 누구나 조회 가능한 상태를
 * 유지한다(전체현황/부서비교 차트가 그 전제로 만들어져 있어서, "다른 부서
 * 데이터 접근 불가" 제한은 개인 식별 정보인 평가/원온원/개인목표에만
 * 적용하는 것으로 해석했다 -- 자세한 이유는 최종 보고 참고).
 */
import { sql } from './db.js';

// account가 employeeId(members.id)의 기록을 다루도록 허용되는지: 본인,
// 그 사람 소속 부서의 부서장, 또는 관리자.
export async function canManageEmployee(account, employeeId) {
  if (account.system_role === 'ADMIN') return true;
  if (account.employee_id === employeeId) return true;
  if (account.system_role === 'DEPARTMENT_HEAD') {
    const [m] = await sql`SELECT team FROM members WHERE id = ${employeeId}`;
    return !!m && m.team === account.department_id;
  }
  return false;
}

// 평가 최종등급(calibration override)처럼 "본인은 스스로 매길 수 없고
// 관리자/그 사람 부서장만" 가능한 동작 전용 -- canManageEmployee와 달리
// 본인 예외가 없다.
export async function canManageEmployeeAsSupervisor(account, employeeId) {
  if (account.system_role === 'ADMIN') return true;
  if (account.system_role === 'DEPARTMENT_HEAD') {
    const [m] = await sql`SELECT team FROM members WHERE id = ${employeeId}`;
    return !!m && m.team === account.department_id;
  }
  return false;
}
