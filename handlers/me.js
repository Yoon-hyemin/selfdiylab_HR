/**
 * handlers/me.js
 *
 * GET -> 200 { id, name, email, team, systemRole, mustChangePassword }
 *
 * 2026-08-07: 계정 기반 로그인 도입으로 members.roles(관리자/부서장/팀원
 * 배열) 대신 accounts.system_role(ADMIN/DEPARTMENT_HEAD/EMPLOYEE, 단일값)을
 * 반환하도록 바꿨다 -- 이 응답이 프론트 전체(사이드바 메뉴, 목표 탭 권한
 * 분기 등)의 "지금 로그인한 사람이 누구고 뭘 할 수 있는지" 단일 소스다.
 *
 * `id`는 일부러 accounts.id가 아니라 accounts.employee_id(=members.id)를
 * 준다 -- 기존 프론트 코드 전체(okr.member===me.id, evals[].employee===me.id
 * 등 수십 곳)가 예전 memberSession 시절부터 "me.id는 구성원 id"라고 전제하고
 * 있어서, 그 계약을 그대로 유지해야 프론트를 대규모로 고치지 않아도 된다.
 * accounts.id 자체를 프론트가 필요로 하는 곳은 없다(비밀번호 변경 등은
 * 세션 쿠키로 계정을 특정하지, 요청 본문에 id를 실어 보내지 않는다).
 *
 * must_change_password=true인 계정도 이 엔드포인트는 호출할 수 있어야
 * 한다(그래야 프론트가 "비밀번호부터 바꿔야 함"을 알고 화면을 그 상태로
 * 고정할 수 있다) -- allowMustChangePassword: true.
 */
import { requireAuth } from './_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireAuth(req, res, { allowMustChangePassword: true });
  if (!account) return;

  res.status(200).json({
    id: account.employee_id,
    name: account.employee_name,
    email: account.email,
    team: account.employee_team || '',
    systemRole: account.system_role,
    mustChangePassword: account.must_change_password,
    canUseTalentSearch: account.can_use_talent_search
  });
}
