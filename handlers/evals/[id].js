/**
 * handlers/evals/[id].js
 *
 * DELETE -> 200 { ok: true }
 *
 * 2026-08-11: 평가 삭제는 자기 자신도 할 수 없게 막는다(기록을 스스로
 * 지울 수 있으면 평가 자체가 무의미해진다) -- 그 직원의 부서장 또는
 * 관리자만 가능하다.
 */
import { sql } from '../_lib/db.js';
import { requireAuth } from '../_lib/accountAuth.js';
import { canManageEmployeeAsSupervisor } from '../_lib/scope.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  const account = await requireAuth(req, res);
  if (!account) return;

  const { id } = req.query;
  try {
    const [row] = await sql`SELECT employee_id FROM evals WHERE id = ${id}`;
    if (!row) return res.status(404).json({ error: '평가를 찾을 수 없어요' });
    if (!(await canManageEmployeeAsSupervisor(account, row.employee_id))) {
      return res.status(403).json({ error: '본인 부서 구성원의 평가만 삭제할 수 있어요' });
    }

    await sql`DELETE FROM evals WHERE id = ${id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete eval' });
  }
}
