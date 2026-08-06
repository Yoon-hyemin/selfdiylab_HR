/**
 * handlers/my-goals/[id].js
 *
 * PATCH { title } -> 200 { ok: true }   개인 목표 제목 수정
 * DELETE          -> 200 { ok: true }   개인 목표 삭제
 *
 * 2026-08-06: handlers/okrs/[id].js와 짝을 이루는 개인 목표용 수정/삭제
 * 엔드포인트. 권한은 딱 하나 — 로그인한 본인이 만든(member_id 일치) 목표만
 * 고치거나 지울 수 있다. 다른 사람의 개인 목표는 관리자든 부서장이든 손댈 수
 * 없다(생성 때부터 본인 명의로만 만들어지는 것과 대칭).
 *
 * 삭제해도 하위 체크리스트(okr_tasks)는 ON DELETE CASCADE로 같이 지워진다.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

export default async function handler(req, res) {
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { id } = req.query;

  try {
    const [okr] = await sql`SELECT id, level, member_id, month FROM okrs WHERE id = ${id}`;
    if (!okr) return res.status(404).json({ error: '목표를 찾을 수 없어요' });
    if (okr.level !== '개인') return res.status(400).json({ error: '개인 목표가 아니에요' });
    if (okr.member_id !== memberId) return res.status(403).json({ error: '본인이 만든 목표만 수정/삭제할 수 있어요' });
    if (!isEditableMonth(okr.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 수정/삭제할 수 있어요' });

    if (req.method === 'PATCH') {
      const title = (req.body && req.body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title is required' });
      await sql`UPDATE okrs SET title = ${title} WHERE id = ${okr.id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM okrs WHERE id = ${okr.id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
}
