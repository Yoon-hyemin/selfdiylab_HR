/**
 * handlers/_lib/hrAuth.js
 *
 * Shared HR password gate.
 *
 * 인사 (구성원 / 채용) data contains employee PII, so those endpoints require a
 * shared secret. 성과관리 (목표 / 평가 / 캘리브레이션 / 원온원) data is
 * company-wide visible and deliberately NOT gated.
 *
 * The frontend sends the shared password in an `X-HR-Password` request header
 * on every request once the user has unlocked the 인사 area. This is a
 * server-side check -- hiding the UI alone would not stop anyone from just
 * calling /api/all directly.
 *
 * Usage in a handler (first line after the method check):
 *   if (!requireHrAuth(req, res)) return;
 */

export function requireHrAuth(req, res) {
  const expected = process.env.HR_PASSWORD;

  // Fail closed: if the deployment has no HR_PASSWORD configured, the gated
  // data must not be reachable at all rather than becoming public.
  if (!expected) {
    res.status(401).json({ error: 'HR 비밀번호가 필요해요' });
    return false;
  }

  const provided = req.headers && (req.headers['x-hr-password'] || req.headers['X-HR-Password']);
  if (provided !== expected) {
    res.status(401).json({ error: 'HR 비밀번호가 필요해요' });
    return false;
  }

  return true;
}

export default requireHrAuth;
