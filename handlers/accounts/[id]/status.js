/**
 * handlers/accounts/[id]/status.js
 *
 * PATCH { status: 'ACTIVE' | 'INACTIVE' } -> 200 { account }
 *
 * 계정 비활성화/재활성화. 퇴사자는 계정을 삭제하지 않고 비활성화만 한다
 * (스펙 10번 -- 목표·평가 이력을 보존해야 하므로). 비활성화하면 즉시
 * 로그인이 막히고(requireAuth가 account_status를 확인) 기존 세션도
 * session_version 증가로 즉시 끊는다.
 *
 * 마지막 남은 활성 ADMIN은 비활성화할 수 없다(스펙 10번).
 */
import { sql } from '../../_lib/db.js';
import { requireRole } from '../../_lib/accountAuth.js';
import { activeAdminCountExcluding, writeAuditLog, account_out } from '../../_lib/accountAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const { id } = req.query;
  const { status } = req.body || {};
  if (status !== 'ACTIVE' && status !== 'INACTIVE') return res.status(400).json({ error: '상태 값이 올바르지 않아요' });

  try {
    const [target] = await sql`
      SELECT a.*, m.name AS employee_name, m.team AS employee_team
      FROM accounts a JOIN members m ON m.id = a.employee_id WHERE a.id = ${id}`;
    if (!target) return res.status(404).json({ error: '계정을 찾을 수 없어요' });

    if (status === 'INACTIVE' && target.system_role === 'ADMIN' && target.account_status === 'ACTIVE') {
      const others = await activeAdminCountExcluding(id);
      if (others === 0) return res.status(400).json({ error: '마지막 남은 관리자 계정이라 비활성화할 수 없어요' });
    }

    const [updated] = await sql`
      UPDATE accounts SET account_status = ${status}, session_version = session_version + 1, updated_at = now()
      WHERE id = ${id} RETURNING *`;
    await writeAuditLog(admin.id, id, status === 'INACTIVE' ? 'ACCOUNT_DEACTIVATED' : 'ACCOUNT_REACTIVATED', {});

    return res.status(200).json({ account: account_out({ ...updated, employee_name: target.employee_name, employee_team: target.employee_team }) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '계정 상태 변경에 실패했어요' });
  }
}
