/**
 * handlers/_lib/accountAuth.js
 *
 * 2026-08-07: 개인 계정 기반 로그인·권한관리의 핵심 모듈. 기존
 * handlers/_lib/memberSession.js(비밀번호 없는 이메일 로그인)와
 * handlers/_lib/hrAuth.js(공용 비밀번호)를 대체한다 -- 이 두 파일은
 * 당장 지우지 않고 남겨두되(이번 마이그레이션이 배포되기 전까지 기존
 * 사이트가 계속 동작해야 하므로), 실제 컷오버 시점에 이 모듈로 완전히
 * 교체된다.
 *
 * 세션 쿠키는 memberSession.js와 같은 "서명된 토큰을 직접 만든다" 패턴을
 * 그대로 따르되(새 JWT 라이브러리 추가 안 함), account.session_version을
 * 토큰에 포함시켜 매 요청마다 DB의 현재 값과 비교한다 -- 이게 있어야
 * "비밀번호 초기화/계정 비활성화 시 기존 세션 즉시 종료"가 가능하다(순수
 * 서명 검증만으로는 예전 토큰도 만료 전까지는 계속 유효해서 원격으로
 * 무효화할 방법이 없다).
 *
 * 비밀번호 해시는 bcryptjs(순수 JS, 네이티브 컴파일 불필요)를 쓴다.
 * argon2가 스펙에 더 최신 권장이지만, 그 패키지들은 Vercel 서버리스
 * 빌드에서 네이티브 바이너리 컴파일/로딩 실패 리스크가 있고, 이 프로젝트는
 * 지금까지 빌드 스텝 없이 순수 ESM 파일만 배포해왔다(package.json에
 * devDependencies/build 스크립트 자체가 없음) -- bcrypt cost factor를
 * 충분히 올려서(12) 실질적인 안전 수준을 맞춘다.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { sql } from './db.js';
import { hashExtensionToken } from './extensionToken.js';

const COOKIE_NAME = 'hr_auth';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12시간 -- 실제 비밀번호가 생긴 뒤라 예전 30일보다 짧게 잡는다.
const BCRYPT_COST = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// 최소 8자, 영문+숫자 포함. 스펙에 명시된 기준 그대로.
export function validatePasswordPolicy(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return '비밀번호는 최소 8자 이상이어야 해요';
  if (!/[A-Za-z]/.test(pw)) return '비밀번호에 영문을 포함해주세요';
  if (!/[0-9]/.test(pw)) return '비밀번호에 숫자를 포함해주세요';
  return null;
}

// 사람이 손으로 옮겨 적어도 헷갈리지 않게 0/O/1/l/I 같은 문자는 뺀다.
// 영문 대소문자+숫자를 섞어 정책(최소 8자, 영문+숫자)을 항상 만족시킨다.
export function generateTempPassword() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(letters), pick(letters), pick(digits), pick(digits)];
  for (let i = chars.length; i < 10; i++) chars.push(pick(all));
  // Fisher-Yates로 섞는다 -- 앞 4자리가 항상 "영영숫숫" 패턴으로 고정되면
  // 패턴을 아는 사람이 임시비밀번호를 추측하기 쉬워진다.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

function sign(payload) {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

// Vercel은 TLS를 프록시에서 종료하고 x-forwarded-proto로 알려준다. 이 헤더가
// https일 때만 Secure를 붙여서, 로컬 http 개발 서버에서는 쿠키가 계속
// 동작하면서 실제 운영(HTTPS)에서는 Secure가 적용되게 한다.
function isHttps(req) {
  return (req.headers && req.headers['x-forwarded-proto']) === 'https';
}

export function createSessionCookie(req, accountId, sessionVersion) {
  const expires = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `${accountId}.${sessionVersion}.${expires}`;
  const token = `${payload}.${sign(payload)}`;
  const secure = isHttps(req) ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearSessionCookie(req) {
  const secure = isHttps(req) ? '; Secure' : '';
  return `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`;
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

// 쿠키 서명·만료만 검증해서 { accountId, sessionVersion }를 돌려준다.
// DB의 현재 session_version과 비교하는 건 호출부(requireAuth)의 책임이다
// -- 여기는 순수 토큰 파싱만 담당해서 DB 접근 없는 경로도 가능하게 한다.
function readSessionToken(req) {
  const token = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [accountId, versionStr, expiresStr, sig] = parts;

  let expected;
  try {
    expected = sign(`${accountId}.${versionStr}.${expiresStr}`);
  } catch {
    return null;
  }
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  if (Date.now() > Number(expiresStr)) return null;

  const sessionVersion = Number(versionStr);
  if (!accountId || !Number.isInteger(sessionVersion)) return null;
  return { accountId, sessionVersion };
}

// employee_id/email/team 등 화면·다른 핸들러가 자주 쓰는 값까지 한 번에
// 가져온다 -- account 하나 검증할 때마다 members를 또 join해서 조회하는
// 중복을 피한다.
export async function loadAccountById(accountId) {
  const [row] = await sql`
    SELECT a.id, a.employee_id, a.email, a.system_role, a.department_id, a.account_status,
           a.must_change_password, a.session_version, a.can_use_talent_search,
           m.name AS employee_name, m.team AS employee_team
    FROM accounts a
    JOIN members m ON m.id = a.employee_id
    WHERE a.id = ${accountId}`;
  return row || null;
}

export async function loadAccountByEmail(email) {
  const [row] = await sql`
    SELECT a.id, a.employee_id, a.email, a.password_hash, a.system_role, a.department_id,
           a.account_status, a.must_change_password, a.failed_login_count, a.locked_until,
           a.session_version, m.name AS employee_name, m.team AS employee_team
    FROM accounts a
    JOIN members m ON m.id = a.employee_id
    WHERE lower(a.email) = ${normalizeEmail(email)}`;
  return row || null;
}

/**
 * 요청에 유효한 세션이 있으면 계정 정보를 반환하고, 없으면 401을 쓰고
 * null을 반환한다. opts.allowMustChangePassword가 false(기본값)면,
 * must_change_password=true인 계정은 403 { mustChangePassword: true }로
 * 막는다 -- "비밀번호 변경 전에는 로그아웃/비밀번호 변경만 가능"을 서버
 * 레벨에서 강제하기 위해서다. /api/me, /api/auth/logout,
 * /api/auth/change-password만 allowMustChangePassword: true로 호출한다.
 */
export async function requireAuth(req, res, opts) {
  opts = opts || {};
  const token = readSessionToken(req);
  if (!token) {
    res.status(401).json({ error: '로그인이 필요해요' });
    return null;
  }

  const account = await loadAccountById(token.accountId);
  if (!account || account.session_version !== token.sessionVersion) {
    res.status(401).json({ error: '로그인이 필요해요' });
    return null;
  }
  if (account.account_status !== 'ACTIVE') {
    res.status(401).json({ error: '비활성화된 계정이에요. 인사팀에 문의해주세요' });
    return null;
  }
  if (account.must_change_password && !opts.allowMustChangePassword) {
    res.status(403).json({ error: '비밀번호를 먼저 변경해주세요', mustChangePassword: true });
    return null;
  }
  return account;
}

// requireAuth + system_role 검사. allowedRoles에 'ADMIN'이 있으면
// DEPARTMENT_HEAD/EMPLOYEE는 통과 못 한다 -- 반대로 ADMIN이 모든 화면에
// 접근 가능한 건(부서장 전용 화면 포함) 각 핸들러가 allowedRoles에
// 'ADMIN'을 항상 같이 넣어서 표현한다(자동으로 상위 권한을 끼워주지
// 않는다 -- 어떤 화면이 ADMIN에게도 열려 있는지 호출부 코드만 보고 알 수
// 있어야 하므로).
export async function requireRole(req, res, allowedRoles) {
  const account = await requireAuth(req, res);
  if (!account) return null;
  if (!allowedRoles.includes(account.system_role)) {
    res.status(403).json({ error: '이 기능에 접근할 권한이 없어요' });
    return null;
  }
  return account;
}

// 인재검색 기능 전용 권한 검사. requireRole(['ADMIN'])과 달리 "ADMIN이거나
// can_use_talent_search 플래그가 켜진 사람" OR 조건이라 requireRole(배열에
// 값이 있는지만 봄)로는 표현이 안 돼서 별도 함수로 뺀다. Phase 1B-1부터
// 인재검색 관련 모든 API는 requireRole 대신 이 함수를 쓴다 -- Phase 1A
// 시점엔 실제 데이터가 없어 프론트엔드 숨김만으로 충분했지만, 이번이
// 실제 데이터를 내려주는 첫 API라 서버 검사가 필요해졌다.
export async function requireTalentSearchAccess(req, res) {
  const account = await requireAuth(req, res);
  if (!account) return null;
  if (account.system_role !== 'ADMIN' && !account.can_use_talent_search) {
    res.status(403).json({ error: '인재검색 권한이 없어요' });
    return null;
  }
  return account;
}

// handlers/_lib/memberSession.js의 requireMemberAuth(memberId를 직접
// 반환)와 같은 모양으로 맞춘 어댑터. 개인 목표/체크리스트/원온원처럼
// "역할과 무관하게 로그인한 본인이 누구인지"만 필요한 핸들러는 이 함수
// 하나로 기존 memberSession 기반 호출을 그대로 대체할 수 있다 -- 반환값이
// members.id(=employee_id)라서 그 아래 로직(팀 조회, 본인 소유 확인 등)은
// 손댈 필요가 없다.
export async function requireEmployeeAuth(req, res) {
  const account = await requireAuth(req, res);
  if (!account) return null;
  return account.employee_id;
}

const GENERIC_LOGIN_ERROR = '이메일 또는 비밀번호가 올바르지 않아요';

/**
 * POST /api/auth/login의 핵심 로직. 이메일 존재 여부/계정 상태를 실패
 * 메시지로 구분해서 흘리지 않는다 -- 딱 하나 예외는 "계정 잠금"인데,
 * 이건 본인이 5번 틀려서 스스로 만든 상태라 노출해도 "이 이메일이
 * 존재한다"는 것 이상의 새 정보가 새지 않고, 잠긴 사용자 입장에서는
 * 몇 분 기다리면 되는지 아는 게 훨씬 도움이 된다.
 */
export async function attemptLogin(email, password) {
  const account = await loadAccountByEmail(email);
  if (!account) return { error: GENERIC_LOGIN_ERROR, accountId: null };

  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    const minutesLeft = Math.ceil((new Date(account.locked_until).getTime() - Date.now()) / 60000);
    return { error: `로그인 시도가 너무 많아 계정이 잠겼어요. ${minutesLeft}분 후 다시 시도해주세요`, accountId: account.id };
  }

  if (account.account_status !== 'ACTIVE') return { error: GENERIC_LOGIN_ERROR, accountId: account.id };

  const ok = await verifyPassword(password, account.password_hash);
  if (!ok) {
    const nextCount = account.failed_login_count + 1;
    if (nextCount >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      await sql`UPDATE accounts SET failed_login_count = 0, locked_until = ${lockedUntil} WHERE id = ${account.id}`;
    } else {
      await sql`UPDATE accounts SET failed_login_count = ${nextCount} WHERE id = ${account.id}`;
    }
    return { error: GENERIC_LOGIN_ERROR, accountId: account.id };
  }

  await sql`UPDATE accounts SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = ${account.id}`;
  return { account };
}

/**
 * 크롬 확장 전용 인증. 쿠키 세션이 아니라 Authorization: Bearer 헤더의
 * 연결 코드로 계정을 찾는다. requireTalentSearchAccess와 마찬가지로
 * ADMIN이거나 can_use_talent_search가 켜진 계정만 통과시킨다 -- 이
 * 기능 전체가 ADMIN 전용이 아니라는 기존 원칙과 동일하게 맞춘다.
 */
export async function requireExtensionToken(req, res) {
  const header = (req.headers && req.headers.authorization) || '';
  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) {
    res.status(401).json({ error: '연결 코드가 필요해요' });
    return null;
  }

  const tokenHash = hashExtensionToken(match[1].trim());
  const [tokenRow] = await sql`
    SELECT account_id FROM talent_search_extension_tokens WHERE token_hash = ${tokenHash}`;
  if (!tokenRow) {
    res.status(401).json({ error: '연결 코드가 올바르지 않아요' });
    return null;
  }

  const account = await loadAccountById(tokenRow.account_id);
  if (!account || account.account_status !== 'ACTIVE') {
    res.status(401).json({ error: '연결 코드가 올바르지 않아요' });
    return null;
  }
  if (account.system_role !== 'ADMIN' && !account.can_use_talent_search) {
    res.status(403).json({ error: '인재검색 권한이 없어요' });
    return null;
  }

  await sql`UPDATE talent_search_extension_tokens SET last_used_at = now() WHERE account_id = ${account.id}`;
  return account;
}

/**
 * GET /api/talent-search-projects(목록 조회)가 쓰는 공용 헬퍼 -- 크롬
 * 확장 팝업이 "어느 프로젝트에 넣을지" 드롭다운을 채울 때는 연결 코드로,
 * HR 사이트 화면에서 호출할 때는 쿠키 세션으로 인증되게 한다.
 * (POST /api/talent-search-extension-token은 항상 쿠키 세션 전용
 * requireTalentSearchAccess만 쓴다 -- 연결 코드를 발급받으려면 이미
 * 로그인이 돼 있어야 하므로 여기서 헤더 인증을 받아줄 이유가 없다.)
 * Authorization 헤더가 있으면 그걸로(확장이 호출하는 경우), 없으면
 * 쿠키 세션으로(HR 사이트 화면에서 호출하는 경우) 인증한다. 두 인증
 * 방식을 동시에 시도하지 않고 헤더 유무로 먼저 분기해서, 쿠키 세션에
 * 실패했다고 401을 쓴 뒤 토큰도 검사하는 이중 응답을 피한다.
 */
export async function requireTalentSearchAccessOrToken(req, res) {
  if (req.headers && req.headers.authorization) {
    return requireExtensionToken(req, res);
  }
  return requireTalentSearchAccess(req, res);
}
