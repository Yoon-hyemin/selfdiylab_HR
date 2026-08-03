/**
 * handlers/member-logout.js
 *
 * POST -> 200 { ok: true } + Set-Cookie (세션 쿠키 삭제)
 */
import { clearSessionCookie } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(200).json({ ok: true });
}
