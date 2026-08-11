/**
 * handlers/oneonones/index.js
 *
 * POST { employeeId, date, note? } -> 201 { id }
 *
 * 2026-08-11: 본인 또는 그 직원의 부서장/관리자만 원온원 기록을 남길 수
 * 있게 좁혔다(handlers/_lib/scope.js).
 */
import { sql } from '../_lib/db.js';
import { requireAuth } from '../_lib/accountAuth.js';
import { canManageEmployee } from '../_lib/scope.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const account = await requireAuth(req, res);
  if (!account) return;

  const b = req.body || {};
  if (!b.employeeId) return res.status(400).json({ error: 'employeeId is required' });
  if (!(await canManageEmployee(account, b.employeeId))) {
    return res.status(403).json({ error: '본인 또는 본인 부서 구성원의 원온원만 기록할 수 있어요' });
  }

  try {
    const [row] = await sql`
      INSERT INTO oneonones (employee_id, date, note)
      VALUES (${b.employeeId}, ${b.date}, ${b.note || '-'})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create one-on-one' });
  }
}
