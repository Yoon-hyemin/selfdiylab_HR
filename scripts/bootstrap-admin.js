/**
 * scripts/bootstrap-admin.js
 *
 * 최초 관리자(ADMIN) 계정을 딱 한 번 만드는 수동 스크립트.
 * INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_TEMP_PASSWORD 환경변수(코드에
 * 하드코딩하지 않음 -- Vercel Production 환경변수나 이 스크립트를 실행하는
 * 로컬 쉘의 환경변수로 준다)를 읽어서:
 *
 *   1. members 테이블에서 그 이메일을 가진 실제 구성원을 찾는다(없으면
 *      실패 -- 최초 관리자도 실제 구성원과 연결돼야 한다).
 *   2. 이미 그 이메일로 계정이 있으면 아무것도 하지 않고 종료한다(멱등 --
 *      배포마다 이 스크립트를 다시 돌려도 기존 비밀번호가 초기화되거나
 *      계정이 중복 생성되지 않는다).
 *   3. 없으면 ADMIN 권한으로 계정을 만들고 must_change_password=true로
 *      설정한다 -- 최초 관리자도 첫 로그인 후 비밀번호를 바꿔야 한다.
 *
 * 사용법:
 *   INITIAL_ADMIN_EMAIL=min02@selfdiylab.com INITIAL_ADMIN_TEMP_PASSWORD=xxxx \
 *     node scripts/bootstrap-admin.js
 *
 * (.env.local에 DATABASE_URL이 있으면 그걸 쓰고, 없으면 셸에 이미 export된
 * DATABASE_URL을 쓴다 -- 운영 DB에 대해 실행하려면 실행 전 DATABASE_URL을
 * Neon 콘솔에서 복사한 운영 접속 문자열로 바꿔야 한다.)
 */
import { readFileSync, existsSync } from 'node:fs';

if (!process.env.DATABASE_URL && existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set (checked env and .env.local)');
  process.exit(1);
}
const email = process.env.INITIAL_ADMIN_EMAIL;
const tempPassword = process.env.INITIAL_ADMIN_TEMP_PASSWORD;
if (!email || !tempPassword) {
  console.error('INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_TEMP_PASSWORD must both be set');
  process.exit(1);
}

const { neon } = await import('@neondatabase/serverless');
const bcrypt = (await import('bcryptjs')).default;
const { validatePasswordPolicy, normalizeEmail } = await import('../handlers/_lib/accountAuth.js');

const sql = neon(process.env.DATABASE_URL);
const normalizedEmail = normalizeEmail(email);

const policyError = validatePasswordPolicy(tempPassword);
if (policyError) {
  console.error('INITIAL_ADMIN_TEMP_PASSWORD does not meet the password policy:', policyError);
  process.exit(1);
}

const [existing] = await sql`SELECT id FROM accounts WHERE lower(email) = ${normalizedEmail}`;
if (existing) {
  console.log(`OK: an account already exists for ${normalizedEmail} -- not touching it (bootstrap is idempotent).`);
  process.exit(0);
}

const [member] = await sql`SELECT id, name, team FROM members WHERE lower(email) = ${normalizedEmail}`;
if (!member) {
  console.error(`No member found with email ${normalizedEmail} -- the initial admin must already exist as a 구성원.`);
  process.exit(1);
}

const hash = await bcrypt.hash(tempPassword, 12);
const [account] = await sql`
  INSERT INTO accounts (employee_id, email, password_hash, system_role, department_id, must_change_password)
  VALUES (${member.id}, ${normalizedEmail}, ${hash}, 'ADMIN', ${member.team || ''}, true)
  RETURNING id`;

await sql`INSERT INTO audit_log (actor_user_id, target_user_id, action, metadata)
  VALUES (${account.id}, ${account.id}, 'ACCOUNT_CREATED', ${JSON.stringify({ via: 'bootstrap-admin.js', systemRole: 'ADMIN' })}::jsonb)`;

console.log(`OK: created ADMIN account for ${member.name} (${normalizedEmail}). must_change_password=true -- hand them the temp password once, out of band.`);
