/**
 * handlers/audit-log/index.js
 *
 * GET -> 200 [{ id, action, actorName, targetName, metadata, createdAt }, ...]
 *
 * ADMIN 전용, 최근 200건. 비밀번호·세션 토큰 값은 애초에 기록하지 않으므로
 * (handlers/_lib/accountAdmin.js의 writeAuditLog 호출부들 참고) 여기서
 * 따로 걸러낼 것도 없다.
 */
import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  try {
    const rows = await sql`
      SELECT al.id, al.action, al.metadata, al.created_at,
             am.name AS actor_name, tm.name AS target_name
      FROM audit_log al
      LEFT JOIN accounts aa ON aa.id = al.actor_user_id
      LEFT JOIN members am ON am.id = aa.employee_id
      LEFT JOIN accounts ta ON ta.id = al.target_user_id
      LEFT JOIN members tm ON tm.id = ta.employee_id
      ORDER BY al.created_at DESC
      LIMIT 200`;

    res.status(200).json(rows.map(r => ({
      id: r.id,
      action: r.action,
      actorName: r.actor_name || '(알 수 없음)',
      targetName: r.target_name || '(알 수 없음)',
      metadata: r.metadata,
      createdAt: r.created_at
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '감사 로그를 불러오지 못했어요' });
  }
}
