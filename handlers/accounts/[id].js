/**
 * handlers/accounts/[id].js
 *
 * PATCH { systemRole } -> 200 { account }   권한(ADMIN/DEPARTMENT_HEAD/EMPLOYEE) 변경
 *
 * 마지막 남은 활성 ADMIN을 이 엔드포인트로 강등시킬 수 없다(스펙 10번 --
 * "마지막 활성 관리자 계정은 비활성화하거나 일반 권한으로 변경할 수 없도록
 * 방지"). 관리자가 스스로를 강등시키는 것도 같은 규칙으로 막힌다(본인이
 * 유일한 ADMIN이면).
 *
 * 권한이 바뀌면 그 사람의 다른 화면 접근 범위가 통째로 바뀌므로, 지금
 * 열려 있는 세션에도 새 권한이 바로 반영되게 session_version을 올려서
 * 강제 재로그인시킨다(그래야 예전 세션 토큰으로 예전 권한 그대로 계속
 * 쓰는 걸 막을 수 있다 -- requireAuth는 매 요청마다 DB에서 system_role을
 * 새로 읽으므로 사실 즉시 반영되긴 하지만, 세션을 갱신해 두는 게 다른
 * 보안 이벤트들과 일관적이다).
 */
import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';
import { activeAdminCountExcluding, writeAuditLog, account_out } from '../_lib/accountAdmin.js';

const VALID_ROLES = ['ADMIN', 'DEPARTMENT_HEAD', 'EMPLOYEE'];

export default async function handler(req, res) {
  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const { id } = req.query;

  if (req.method === 'PATCH') {
    const { systemRole } = req.body || {};
    if (!VALID_ROLES.includes(systemRole)) return res.status(400).json({ error: '권한 값이 올바르지 않아요' });

    try {
      const [target] = await sql`
        SELECT a.*, m.name AS employee_name, m.team AS employee_team
        FROM accounts a JOIN members m ON m.id = a.employee_id WHERE a.id = ${id}`;
      if (!target) return res.status(404).json({ error: '계정을 찾을 수 없어요' });

      if (target.system_role === 'ADMIN' && systemRole !== 'ADMIN' && target.account_status === 'ACTIVE') {
        const others = await activeAdminCountExcluding(id);
        if (others === 0) return res.status(400).json({ error: '마지막 남은 관리자 계정이라 권한을 바꿀 수 없어요' });
      }

      const [updated] = await sql`
        UPDATE accounts SET system_role = ${systemRole}, session_version = session_version + 1, updated_at = now()
        WHERE id = ${id} RETURNING *`;
      await writeAuditLog(admin.id, id, 'ROLE_CHANGE', { from: target.system_role, to: systemRole });

      return res.status(200).json({ account: account_out({ ...updated, employee_name: target.employee_name, employee_team: target.employee_team }) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '권한 변경에 실패했어요' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
