/**
 * handlers/accounts/[id]/unlock.js
 *
 * POST -> 200 { ok: true }
 *
 * 로그인 5회 실패로 잠긴 계정을 관리자가 즉시 풀어준다. 비밀번호 자체는
 * 그대로 유지된다(초기화가 아니라 잠금 해제만) -- 본인이 비밀번호를
 * 기억하고 있는데 실수로 여러 번 틀려서 잠긴 경우를 위한 것.
 */
import { sql } from '../../_lib/db.js';
import { requireRole } from '../../_lib/accountAuth.js';
import { writeAuditLog } from '../../_lib/accountAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const { id } = req.query;

  try {
    const [target] = await sql`SELECT id FROM accounts WHERE id = ${id}`;
    if (!target) return res.status(404).json({ error: '계정을 찾을 수 없어요' });

    await sql`UPDATE accounts SET failed_login_count = 0, locked_until = NULL, updated_at = now() WHERE id = ${id}`;
    await writeAuditLog(admin.id, id, 'ACCOUNT_UNLOCKED', {});

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '잠금 해제에 실패했어요' });
  }
}
