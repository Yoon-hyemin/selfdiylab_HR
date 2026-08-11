/**
 * handlers/calibration/[quarter]/overrides.js
 *
 * PUT { evalId, grade, reason? } -> 200 { ok: true }
 *
 * 2026-08-11: 등급 배분(캘리브레이션)은 그 평가 대상자의 부서장 또는
 * 관리자만 할 수 있다 -- 자기 자신에게 최종 등급을 매기는 자기결정을
 * 막기 위해 canManageEmployee가 아니라 canManageEmployeeAsSupervisor를
 * 쓴다(본인 예외 없음).
 */
import { sql } from '../../_lib/db.js';
import { requireAuth } from '../../_lib/accountAuth.js';
import { canManageEmployeeAsSupervisor } from '../../_lib/scope.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const account = await requireAuth(req, res);
  if (!account) return;

  const { quarter } = req.query;
  const { evalId, grade, reason } = req.body || {};
  if (!evalId || !grade) return res.status(400).json({ error: 'evalId and grade are required' });

  try {
    const [evalRow] = await sql`SELECT employee_id FROM evals WHERE id = ${evalId}`;
    if (!evalRow) return res.status(404).json({ error: '평가를 찾을 수 없어요' });
    if (!(await canManageEmployeeAsSupervisor(account, evalRow.employee_id))) {
      return res.status(403).json({ error: '본인 부서 구성원의 등급만 배분할 수 있어요' });
    }

    await sql`INSERT INTO calibration_cycles (quarter) VALUES (${quarter}) ON CONFLICT (quarter) DO NOTHING`;
    await sql`
      INSERT INTO calibration_overrides (quarter, eval_id, grade, reason)
      VALUES (${quarter}, ${evalId}, ${grade}, ${reason || ''})
      ON CONFLICT (quarter, eval_id) DO UPDATE SET grade = EXCLUDED.grade, reason = EXCLUDED.reason`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update calibration override' });
  }
}
