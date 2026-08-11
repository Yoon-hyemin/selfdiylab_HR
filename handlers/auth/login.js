/**
 * handlers/auth/login.js
 *
 * POST { email, password } -> 200 { ok:true, account } + Set-Cookie
 *                          -> 401 { error }
 *
 * accounts 테이블 기반 로그인. handlers/member-login.js(비밀번호 없이
 * 이메일만 확인하던 방식)를 대체한다 -- 실제 컷오버 시점에 그 파일은
 * 삭제/무력화된다.
 */
import { sql } from '../_lib/db.js';
import { attemptLogin, createSessionCookie } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = (req.body && req.body.email) || '';
  const password = (req.body && req.body.password) || '';
  if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요' });

  try {
    const { account, error, accountId } = await attemptLogin(email, password);
    if (error) {
      await sql`INSERT INTO audit_log (actor_user_id, target_user_id, action, metadata)
        VALUES (${accountId}, ${accountId}, 'LOGIN_FAILURE', ${JSON.stringify({ email: email.toLowerCase() })}::jsonb)`;
      return res.status(401).json({ error });
    }

    await sql`INSERT INTO audit_log (actor_user_id, target_user_id, action, metadata)
      VALUES (${account.id}, ${account.id}, 'LOGIN_SUCCESS', '{}'::jsonb)`;

    res.setHeader('Set-Cookie', createSessionCookie(req, account.id, account.session_version));
    res.status(200).json({
      ok: true,
      // id는 accounts.id가 아니라 employee_id다 -- handlers/me.js와 같은 계약
      // (기존 프론트가 "me.id는 구성원 id"라고 전제하고 있음).
      account: {
        id: account.employee_id,
        name: account.employee_name,
        email: account.email,
        team: account.employee_team || '',
        systemRole: account.system_role,
        mustChangePassword: account.must_change_password
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '로그인에 실패했어요' });
  }
}
