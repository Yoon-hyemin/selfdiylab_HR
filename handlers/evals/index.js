/**
 * handlers/evals/index.js
 *
 * POST { employeeId, ... } -> 201 { id }
 *
 * 2026-08-11: 이전엔 로그인 없이 아무나 아무 직원의 평가를 만들 수 있었다.
 * 본인(자기평가) 또는 그 직원의 부서장/관리자만 만들 수 있게 좁혔다
 * (handlers/_lib/scope.js의 canManageEmployee).
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
    return res.status(403).json({ error: '본인 또는 본인 부서 구성원의 평가만 작성할 수 있어요' });
  }

  try {
    const [row] = await sql`
      INSERT INTO evals (quarter, employee_id, common, lead, job, performance, custom, strength, improve)
      VALUES (${b.quarter || '2026-Q2'}, ${b.employeeId}, ${b.common}, ${b.lead}, ${b.job}, ${b.performance}, ${b.custom}, ${b.strength || '-'}, ${b.improve || '-'})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create eval' });
  }
}
