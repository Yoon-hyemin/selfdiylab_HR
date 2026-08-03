/**
 * handlers/me.js
 *
 * GET -> 200 { id, name, team }  로그인한 본인 정보 (team은 "우리 팀 달성률"
 * 계산에 쓰이는 본인만의 정보라 공개 API(public-data)에는 안 내려가는
 * team을 여기서만 노출한다).
 */
import { sql } from './_lib/db.js';
import { requireMemberAuth } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  try {
    const rows = await sql`SELECT id, name, team FROM members WHERE id = ${memberId}`;
    if (!rows.length) return res.status(401).json({ error: '로그인이 필요해요' });
    res.status(200).json({ id: rows[0].id, name: rows[0].name, team: rows[0].team || '' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '내 정보를 불러오지 못했어요' });
  }
}
