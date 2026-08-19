/**
 * handlers/_lib/accountAdmin.js
 *
 * handlers/accounts/* 전용 공용 유틸. "계정 및 권한 관리" 화면(ADMIN
 * 전용)이 쓰는 계정 목록 매핑, 감사 로그 기록, "마지막 남은 ADMIN 보호"
 * 검사를 한 곳에 모아뒀다 -- 여러 엔드포인트(권한 변경/비활성화)가 같은
 * "마지막 ADMIN 보호" 규칙을 지켜야 하므로 중복 없이 여기서만 관리한다.
 */
import { sql } from './db.js';

export function account_out(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    employeeTeam: row.employee_team,
    email: row.email,
    systemRole: row.system_role,
    departmentId: row.department_id,
    accountStatus: row.account_status,
    mustChangePassword: row.must_change_password,
    canUseTalentSearch: row.can_use_talent_search,
    failedLoginCount: row.failed_login_count,
    isLocked: !!(row.locked_until && new Date(row.locked_until).getTime() > Date.now()),
    lastLoginAt: row.last_login_at,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listAccounts() {
  const rows = await sql`
    SELECT a.*, m.name AS employee_name, m.team AS employee_team
    FROM accounts a
    JOIN members m ON m.id = a.employee_id
    ORDER BY m.team, m.name`;
  return rows.map(account_out);
}

// target을 제외하고 세어서, "지금 이 계정을 ADMIN에서 내리거나 비활성화하면
// ADMIN이 0명이 되는가"를 안전하게 판단할 수 있게 한다.
export async function activeAdminCountExcluding(excludeAccountId) {
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM accounts
    WHERE system_role = 'ADMIN' AND account_status = 'ACTIVE' AND id != ${excludeAccountId}`;
  return count;
}

export async function writeAuditLog(actorAccountId, targetAccountId, action, metadata) {
  await sql`INSERT INTO audit_log (actor_user_id, target_user_id, action, metadata)
    VALUES (${actorAccountId}, ${targetAccountId}, ${action}, ${JSON.stringify(metadata || {})}::jsonb)`;
}
