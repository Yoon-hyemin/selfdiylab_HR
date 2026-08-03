/**
 * handlers/_lib/memberSession.js
 *
 * 개인(구성원) 로그인 세션. 비밀번호 없이 이메일만으로 로그인하므로(POST
 * /api/member-login), 여기서 발급하는 쿠키는 "이 요청이 로그인 시점에 그
 * 이메일로 확인된 구성원의 것"이라는 것만 보장한다 — HR_PASSWORD 같은
 * 비밀 검증이 아니라, 위조 방지를 위한 서명(HMAC)이다.
 *
 * 새 의존성을 추가하지 않기 위해 JWT 라이브러리 대신 Node 내장 crypto로
 * "memberId.만료시각.서명" 형태의 토큰을 직접 만든다.
 */
import crypto from 'node:crypto';

const COOKIE_NAME = 'member_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30일

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createSessionCookie(memberId) {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = `${memberId}.${expires}`;
  const token = `${payload}.${sign(payload)}`;
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

export function getSessionMemberId(req) {
  const token = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [memberId, expiresStr, sig] = parts;

  let expected;
  try {
    expected = sign(`${memberId}.${expiresStr}`);
  } catch {
    return null; // SESSION_SECRET not configured
  }
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  if (Date.now() > Number(expiresStr)) return null;
  return memberId;
}

export function requireMemberAuth(req, res) {
  const memberId = getSessionMemberId(req);
  if (!memberId) {
    res.status(401).json({ error: '로그인이 필요해요' });
    return null;
  }
  return memberId;
}
