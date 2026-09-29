// handlers/_lib/extensionSessionToken.js
/**
 * 크롬 확장용 "임시 통행증"(2026-09-29 추가). HR 사이트에 로그인한 사람이
 * [사람인에서 수집 시작]을 누르면 서버가 이걸 발급해 확장에 넘겨준다 --
 * 연결 코드를 컴퓨터마다 손으로 붙여넣던 번거로움을 없애기 위해서다.
 * 연결 코드(extensionToken.js)는 계정당 하나라 다른 컴퓨터에서 재발급하면
 * 기존 컴퓨터가 끊기는 문제도 있었는데, 이건 버튼을 누를 때마다 새로
 * 받으므로 컴퓨터끼리 서로 끊지 않는다.
 *
 * 형식: `ext.<accountId>.<sessionVersion>.<expiresMs>.<서명>` -- 로그인
 * 쿠키(accountAuth.js의 createSessionCookie)와 같은 "서명된 토큰을 직접
 * 만드는" 패턴이고 같은 SESSION_SECRET을 쓴다. 다만 앞에 'ext.'를 붙여
 * 서명 대상 자체를 다르게 했다 -- 이 통행증을 쿠키 자리에 넣어도(조각
 * 수가 달라) 로그인 세션으로 인정되지 않고, 반대로 로그인 쿠키 값을
 * Bearer로 보내도 통행증으로 인정되지 않는다(확장 API 전용 권한 분리).
 * session_version을 담아서, 비밀번호 초기화·비활성화·권한 변경 때 로그인
 * 세션과 똑같이 즉시 무효가 된다(그 비교는 DB를 보는 호출부 책임).
 *
 * DB를 import하지 않는다 -- DATABASE_URL 없이 node --test로 돈다.
 */
import crypto from 'node:crypto';

export const EXTENSION_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const PREFIX = 'ext';

function sign(payload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function isExtensionSessionToken(token) {
  return typeof token === 'string' && token.startsWith(PREFIX + '.');
}

export function createExtensionSessionToken(accountId, sessionVersion, now = Date.now()) {
  const expiresAt = now + EXTENSION_SESSION_MAX_AGE_MS;
  const payload = `${PREFIX}.${accountId}.${sessionVersion}.${expiresAt}`;
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

// 서명·만료만 검증해서 { accountId, sessionVersion }을 돌려준다(틀리면 null).
export function readExtensionSessionToken(token, now = Date.now()) {
  if (!isExtensionSessionToken(token)) return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [prefix, accountId, versionStr, expiresStr, sig] = parts;
  let expected;
  try { expected = sign(`${prefix}.${accountId}.${versionStr}.${expiresStr}`); } catch { return null; }
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  if (!(now <= Number(expiresStr))) return null;
  const sessionVersion = Number(versionStr);
  if (!accountId || !Number.isInteger(sessionVersion)) return null;
  return { accountId, sessionVersion };
}
