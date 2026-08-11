/**
 * handlers/auth/change-password.js
 *
 * POST { currentPassword, newPassword, confirmPassword } -> 200 { ok: true } + 새 Set-Cookie
 *
 * 본인 비밀번호 변경. must_change_password=true인 상태에서도 호출 가능해야
 * 해서 requireAuth(allowMustChangePassword: true)로 통과시킨다(그래야
 * 최초 로그인/비밀번호 초기화 직후 "비밀번호 변경 화면"이 실제로 동작한다).
 *
 * 비밀번호를 바꾸면 session_version을 올려서 다른 곳에 남아있을 수 있는
 * 예전 세션을 전부 무효화한다 -- 단, 지금 이 요청을 보낸 브라우저까지
 * 로그아웃시키면 안 되니 새 session_version으로 쿠키를 다시 발급해서
 * 응답에 실어준다.
 */
import { sql } from '../_lib/db.js';
import {
  requireAuth, verifyPassword, hashPassword, validatePasswordPolicy, createSessionCookie
} from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireAuth(req, res, { allowMustChangePassword: true });
  if (!account) return;

  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 모두 입력해주세요' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: '새 비밀번호가 서로 일치하지 않아요' });
  }

  try {
    const [row] = await sql`SELECT password_hash FROM accounts WHERE id = ${account.id}`;
    const currentOk = await verifyPassword(currentPassword, row.password_hash);
    if (!currentOk) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않아요' });

    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) return res.status(400).json({ error: policyError });

    const sameAsBefore = await verifyPassword(newPassword, row.password_hash);
    if (sameAsBefore) return res.status(400).json({ error: '현재 비밀번호와 다른 비밀번호를 입력해주세요' });

    const newHash = await hashPassword(newPassword);
    const [updated] = await sql`
      UPDATE accounts
      SET password_hash = ${newHash}, must_change_password = false,
          password_changed_at = now(), session_version = session_version + 1
      WHERE id = ${account.id}
      RETURNING session_version`;

    await sql`INSERT INTO audit_log (actor_user_id, target_user_id, action, metadata)
      VALUES (${account.id}, ${account.id}, 'PASSWORD_CHANGE_SELF', '{}'::jsonb)`;

    res.setHeader('Set-Cookie', createSessionCookie(req, account.id, updated.session_version));
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '비밀번호 변경에 실패했어요' });
  }
}
