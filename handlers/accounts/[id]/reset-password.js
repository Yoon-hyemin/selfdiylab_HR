/**
 * handlers/accounts/[id]/reset-password.js
 *
 * POST -> 200 { tempPassword }
 *
 * 관리자가 직원의 비밀번호를 잊었을 때 초기화하는 절차(스펙 6번)를
 * 그대로 구현한다: 새 임시 비밀번호를 서버에서 생성 -> 기존 세션 전부
 * 종료(session_version 증가) -> must_change_password=true -> 실패
 * 횟수/잠금 초기화 -> 감사 로그 기록. 관리자는 기존 비밀번호를 조회할 수
 * 없다 -- 애초에 해시만 저장돼 있어서 "조회"라는 개념 자체가 없다.
 */
import { sql } from '../../_lib/db.js';
import { requireRole, generateTempPassword, hashPassword } from '../../_lib/accountAuth.js';
import { writeAuditLog } from '../../_lib/accountAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const { id } = req.query;

  try {
    const [target] = await sql`SELECT id FROM accounts WHERE id = ${id}`;
    if (!target) return res.status(404).json({ error: '계정을 찾을 수 없어요' });

    const tempPassword = generateTempPassword();
    const hash = await hashPassword(tempPassword);
    await sql`
      UPDATE accounts
      SET password_hash = ${hash}, must_change_password = true, failed_login_count = 0,
          locked_until = NULL, session_version = session_version + 1, updated_at = now()
      WHERE id = ${id}`;

    await writeAuditLog(admin.id, id, 'PASSWORD_RESET_BY_ADMIN', {});

    res.status(200).json({ tempPassword });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '비밀번호 초기화에 실패했어요' });
  }
}
