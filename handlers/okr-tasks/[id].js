/**
 * handlers/okr-tasks/[id].js
 *
 * PATCH { done } -> 200 { ok: true }   체크/해제
 * DELETE         -> 200 { ok: true }   삭제
 *
 * 두 메서드 모두 이 task가 속한 okrs.member_id가 세션 memberId와 같을 때만
 * 허용한다. 2026-08-04: 그 목표의 월이 이번 달/지난달이 아니면 거부한다.
 */
import { sql } from '../_lib/db.js';
import { requireEmployeeAuth } from '../_lib/accountAuth.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

async function loadOwnedTask(id, memberId) {
  const [row] = await sql`
    SELECT t.id, o.month FROM okr_tasks t
    JOIN okrs o ON o.id = t.okr_id
    WHERE t.id = ${id} AND o.member_id = ${memberId}`;
  return row || null;
}

export default async function handler(req, res) {
  const memberId = await requireEmployeeAuth(req, res);
  if (!memberId) return;
  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const { done } = req.body || {};
      if (typeof done !== 'boolean') return res.status(400).json({ error: 'done must be boolean' });
      const task = await loadOwnedTask(id, memberId);
      if (!task) return res.status(403).json({ error: '본인 할 일만 수정할 수 있어요' });
      if (!isEditableMonth(task.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 수정할 수 있어요' });
      await sql`UPDATE okr_tasks SET done = ${done} WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const task = await loadOwnedTask(id, memberId);
      if (!task) return res.status(403).json({ error: '본인 할 일만 삭제할 수 있어요' });
      if (!isEditableMonth(task.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 삭제할 수 있어요' });
      await sql`DELETE FROM okr_tasks WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update task' });
  }
}
