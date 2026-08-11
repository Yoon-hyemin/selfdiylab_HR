/**
 * handlers/okr-tasks/index.js
 *
 * POST { okrId, title } -> 201 { id }
 *
 * 본인이 소유한 개인 목표(okrs.member_id = 세션 memberId)에만 할 일을
 * 추가할 수 있다. 2026-08-04: 그 목표의 월이 이번 달/지난달이 아니면 거부.
 */
import { sql } from '../_lib/db.js';
import { requireEmployeeAuth } from '../_lib/accountAuth.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = await requireEmployeeAuth(req, res);
  if (!memberId) return;

  const { okrId, title } = req.body || {};
  if (!okrId || !title || !title.trim()) return res.status(400).json({ error: 'okrId and title are required' });

  try {
    const [okr] = await sql`SELECT id, member_id, month FROM okrs WHERE id = ${okrId}`;
    if (!okr || okr.member_id !== memberId) {
      return res.status(403).json({ error: '본인 목표에만 할 일을 추가할 수 있어요' });
    }
    if (!isEditableMonth(okr.month)) {
      return res.status(400).json({ error: '이번 달/지난달 목표만 수정할 수 있어요' });
    }

    const [row] = await sql`INSERT INTO okr_tasks (okr_id, title) VALUES (${okrId}, ${title.trim()}) RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task' });
  }
}
