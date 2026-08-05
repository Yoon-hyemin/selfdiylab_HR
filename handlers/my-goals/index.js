/**
 * handlers/my-goals/index.js
 *
 * POST { parentId, title } -> 201 { id }
 *
 * 개인(레벨='개인') 목표 생성 전용 엔드포인트. /api/okrs는 이 레벨을
 * 거부한다 — 개인 목표는 반드시 로그인한 본인 명의로만 만들어져야 하므로
 * 세션에서 얻은 memberId를 그대로 소유자로 쓴다(요청 바디의 소유자는
 * 받지 않음). quarter/month는 상위(부서) 목표에서 그대로 상속한다.
 *
 * 2026-08-04: 상위 부서 목표가 로그인한 본인의 팀 소속인지 확인하는 검증을
 * 추가했다 — 이전에는 다른 팀의 부서 목표에도 개인 목표를 붙일 수 있었다.
 * 상위 부서 목표의 월이 이번 달/지난달이 아니면 거부한다.
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { parentId, title } = req.body || {};
  if (!parentId) return res.status(400).json({ error: '연결할 부서 목표를 선택해주세요' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const [me] = await sql`SELECT team FROM members WHERE id = ${memberId}`;
    const [parent] = await sql`SELECT id, quarter, month, level, owner FROM okrs WHERE id = ${parentId}`;
    if (!parent || parent.level !== '조직') {
      return res.status(400).json({ error: '상위 목표는 부서 목표여야 해요' });
    }
    if (!me || parent.owner !== me.team) {
      return res.status(403).json({ error: '본인 팀의 부서 목표에만 연결할 수 있어요' });
    }
    if (!isEditableMonth(parent.month)) {
      return res.status(400).json({ error: '이번 달/지난달 부서 목표에만 연결할 수 있어요' });
    }

    const [row] = await sql`
      INSERT INTO okrs (quarter, month, level, title, owner, parent_id, member_id, progress, unit, target)
      VALUES (${parent.quarter}, ${parent.month}, '개인', ${title.trim()}, '-', ${parent.id}, ${memberId}, 0, '%', 100)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
}
