/**
 * handlers/accounts/index.js
 *
 * GET  -> 200 [account, ...]   전체 계정 목록 (ADMIN 전용, "계정 및 권한 관리" 화면)
 * POST { employeeId, systemRole, tempPassword? } -> 201 { account, tempPassword }
 *
 * 계정 생성은 이미 members에 있는 구성원 중 계정이 없는 사람만 대상으로
 * 한다 -- 회원가입 기능은 없다(스펙 3번 요구사항). 프론트가 "계정 없는
 * 구성원" 목록을 만드는 방법은 /api/members(전체 구성원) 응답에서
 * /api/accounts에 이미 있는 employeeId를 빼는 것 -- 이 프로젝트의
 * "서버는 원본만, 계산은 클라이언트가" 원칙 그대로라 여기서 별도
 * "계정 없는 구성원" 엔드포인트를 새로 만들지 않는다.
 *
 * 임시 비밀번호는 이 응답에 딱 한 번만 담겨서 나간다 -- DB에는 해시만
 * 저장되고, 이후에는 관리자도 이 값을 다시 조회할 수 없다.
 *
 * 2026-08-11: tempPassword를 관리자가 직접 입력할 수 있게 했다(안 주면
 * 기존처럼 자동 생성). 자동 생성 값이 매번 달라서 구두로 전달하기 번거롭다는
 * 피드백 때문인데, 그렇다고 "고정된 하나의 값을 코드에 박아두는" 방식은
 * 채택하지 않았다 -- 그러면 그 값이 알려지는 순간부터, 아직 비밀번호를 안
 * 바꾼 모든 계정에 그 값 하나로 로그인할 수 있는 상태가 계속 유지돼서
 * (이메일은 이름@selfdiylab.com 패턴이라 사실상 공개 정보) 이 작업 전체가
 * 없애려던 "공용 비밀번호" 문제가 그대로 재현된다. 대신 관리자가 매번 화면에서
 * 직접 타이핑하게 해서, 같은 값을 계속 재사용하든 말든 그건 운영 판단으로
 * 남기고 시스템이 그걸 강제로 고정하지는 않는다. 정책(최소 8자, 영문+숫자)은
 * 그대로 적용된다.
 */
import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';
import { generateTempPassword, hashPassword, validatePasswordPolicy } from '../_lib/accountAuth.js';
import { listAccounts, account_out, writeAuditLog } from '../_lib/accountAdmin.js';

const VALID_ROLES = ['ADMIN', 'DEPARTMENT_HEAD', 'EMPLOYEE'];

export default async function handler(req, res) {
  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  if (req.method === 'GET') {
    try {
      const accounts = await listAccounts();
      return res.status(200).json(accounts);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '계정 목록을 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    const { employeeId, systemRole, tempPassword: customTempPassword } = req.body || {};
    if (!employeeId) return res.status(400).json({ error: '구성원을 선택해주세요' });
    if (!VALID_ROLES.includes(systemRole)) return res.status(400).json({ error: '권한 값이 올바르지 않아요' });
    if (customTempPassword) {
      const policyError = validatePasswordPolicy(customTempPassword);
      if (policyError) return res.status(400).json({ error: policyError });
    }

    try {
      const [member] = await sql`SELECT id, name, team, email FROM members WHERE id = ${employeeId}`;
      if (!member) return res.status(404).json({ error: '구성원을 찾을 수 없어요' });
      if (!member.email) return res.status(400).json({ error: '이 구성원은 등록된 이메일이 없어요. 먼저 구성원 정보에 이메일을 입력해주세요' });

      const [existing] = await sql`SELECT id FROM accounts WHERE employee_id = ${employeeId}`;
      if (existing) return res.status(409).json({ error: '이미 계정이 있는 구성원이에요' });

      const tempPassword = customTempPassword || generateTempPassword();
      const hash = await hashPassword(tempPassword);
      const [account] = await sql`
        INSERT INTO accounts (employee_id, email, password_hash, system_role, department_id, must_change_password)
        VALUES (${employeeId}, ${member.email}, ${hash}, ${systemRole}, ${member.team || ''}, true)
        RETURNING id`;

      await writeAuditLog(admin.id, account.id, 'ACCOUNT_CREATED', { systemRole, employeeName: member.name });

      const [full] = await sql`
        SELECT a.*, m.name AS employee_name, m.team AS employee_team
        FROM accounts a JOIN members m ON m.id = a.employee_id WHERE a.id = ${account.id}`;
      return res.status(201).json({ account: account_out(full), tempPassword });
    } catch (err) {
      if (err && err.code === '23505') return res.status(409).json({ error: '이미 계정이 있는 이메일이에요' });
      console.error(err);
      return res.status(500).json({ error: '계정 생성에 실패했어요' });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}
