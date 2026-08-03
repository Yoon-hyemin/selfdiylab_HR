/**
 * handlers/hr-auth.js
 *
 * POST { password } -> 200 { ok: true }  when it matches process.env.HR_PASSWORD
 *                   -> 401 { ok: false, error } otherwise
 *
 * This endpoint itself needs no auth -- it IS the auth check. The frontend
 * calls it once when the user tries to open a 인사 view, and on success starts
 * sending the same password as an X-HR-Password header on every request (see
 * handlers/_lib/hrAuth.js).
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const expected = process.env.HR_PASSWORD;

  // A misconfigured deployment (no HR_PASSWORD set) is indistinguishable from a
  // wrong password to the client -- deliberately, so this endpoint never reveals
  // whether a password is even configured. Log it server-side so the operator
  // can actually diagnose "nobody can unlock the 인사 area".
  if (!expected) {
    console.error('HR_PASSWORD is not set; the 인사 area cannot be unlocked. Set it in the deployment environment variables.');
  }

  if (!expected || typeof password !== 'string' || password !== expected) {
    return res.status(401).json({ ok: false, error: '비밀번호가 올바르지 않아요' });
  }

  return res.status(200).json({ ok: true });
}
