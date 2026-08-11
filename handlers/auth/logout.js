/**
 * handlers/auth/logout.js
 *
 * POST -> 200 { ok: true } + 세션 쿠키 삭제
 *
 * 세션이 이미 만료/없는 상태에서 호출해도 그냥 성공으로 처리한다(로그아웃은
 * 멱등이어야 한다 -- "이미 로그아웃된 상태"를 에러로 취급할 이유가 없다).
 */
import { clearSessionCookie } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  res.setHeader('Set-Cookie', clearSessionCookie(req));
  res.status(200).json({ ok: true });
}
