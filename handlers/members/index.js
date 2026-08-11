import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';

const ALLOWED_ROLES = ['관리자', '부서장', '팀원'];

// b.roles: 관리자/부서장을 몇 개든 동시에 가질 수 있음(2026-08-05, 복수 역할
// 지원). 유효하지 않은 값은 걸러내고, 남는 게 없으면 '팀원' 하나로 채운다.
function normalizeRoles(roles) {
  const filtered = Array.isArray(roles) ? roles.filter(r => ALLOWED_ROLES.includes(r) && r !== '팀원') : [];
  return filtered.length ? filtered : ['팀원'];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireRole(req, res, ['ADMIN']))) return;
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });
  const roles = normalizeRoles(b.roles);

  try {
    const [row] = await sql`
      INSERT INTO members (name, team, position, email, phone, hire_date, group_hire_date, hire_type, work_type_name, work_type_fixed, worked_hours, leave_left, deduction_basic, deduction_health_dependents, roles)
      VALUES (${b.name}, ${b.team || ''}, ${b.position || ''}, ${b.email || ''}, ${b.phone || ''}, ${b.hireDate || new Date().toISOString().slice(0,10)}, ${b.groupHireDate || new Date().toISOString().slice(0,10)}, '정규직', '', true, '0시간', '0일', 0, 0, ${roles})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create member' });
  }
}
