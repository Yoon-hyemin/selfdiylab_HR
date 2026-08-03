/**
 * handlers/okr-tasks/[id].js
 *
 * PATCH { done } -> 200 { ok: true }   체크/해제
 * DELETE         -> 200 { ok: true }   삭제
 *
 * 두 메서드 모두 이 task가 속한 okrs.member_id가 세션 memberId와 같을 때만
 * 허용한다.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';

async function loadOwnedTask(id, memberId) {
  const [row] = await sql`
    SELECT t.id FROM okr_tasks t
    JOIN okrs o ON o.id = t.okr_id
    WHERE t.id = ${id} AND o.member_id = ${memberId}`;
  return row || null;
}

export default async function handler(req, res) {
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;
  const { id } = req.query;

  try {
    if (req.method === 'PATCH') {
      const { done } = req.body || {};
      if (typeof done !== 'boolean') return res.status(400).json({ error: 'done must be boolean' });
      if (!(await loadOwnedTask(id, memberId))) return res.status(403).json({ error: '본인 할 일만 수정할 수 있어요' });
      await sql`UPDATE okr_tasks SET done = ${done} WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      if (!(await loadOwnedTask(id, memberId))) return res.status(403).json({ error: '본인 할 일만 삭제할 수 있어요' });
      await sql`DELETE FROM okr_tasks WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update task' });
  }
}
