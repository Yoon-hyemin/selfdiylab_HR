/**
 * handlers/member-login.js
 *
 * POST { email } -> 200 { ok: true, member: {id, name} } + Set-Cookie
 *               -> 401 { error }  이메일이 등록되어 있지 않으면
 *
 * 비밀번호 없음 — 인사팀이 구성원 등록/수정 화면에서 미리 넣어둔 email과
 * 대소문자 무시 일치하면 로그인 성공으로 간주한다.
 */
import { sql } from './_lib/db.js';
import { createSessionCookie } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email = (req.body && req.body.email || '').trim();
  if (!email) return res.status(400).json({ error: '이메일을 입력해주세요' });

  try {
    const rows = await sql`SELECT id, name FROM members WHERE lower(email) = lower(${email}) LIMIT 1`;
    if (!rows.length) return res.status(401).json({ error: '등록된 이메일이 아니에요. 인사팀에 문의해주세요' });

    res.setHeader('Set-Cookie', createSessionCookie(rows[0].id));
    res.status(200).json({ ok: true, member: { id: rows[0].id, name: rows[0].name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '로그인에 실패했어요' });
  }
}
