import { sql } from '../_lib/db.js';
import { requireHrAuth } from '../_lib/hrAuth.js';

const FIELD_MAP = {
  name: 'name', nickname: 'nickname', team: 'team', position: 'position',
  email: 'email', personalEmail: 'personal_email', employeeNo: 'employee_no',
  hireDate: 'hire_date', groupHireDate: 'group_hire_date', hireType: 'hire_type',
  birthday: 'birthday', phone: 'phone', address: 'address',
  laborContract: 'labor_contract', wageContract: 'wage_contract', salaryPayInfo: 'salary_pay_info',
  overtimePolicy: 'overtime_policy', hrInfo: 'hr_info', intro: 'intro',
  specialNotes: 'special_notes', workedHours: 'worked_hours', leaveLeft: 'leave_left'
};

// hire_date / group_hire_date / birthday are `date` columns; an empty string
// (e.g. a cleared <input type="date">) is not a valid date and Postgres
// rejects it, so normalize '' to NULL for these fields only.
const DATE_FIELDS = new Set(['hireDate', 'groupHireDate', 'birthday']);

export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireHrAuth(req, res)) return;

  const body = req.body || {};
  const sets = [];
  const values = [];
  let i = 1;

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (key in body) {
      let value = body[key];
      if (DATE_FIELDS.has(key) && value === '') value = null;
      sets.push(`${column} = $${i++}`); values.push(value);
    }
  }
  // roles: 관리자/부서장을 동시에 가질 수 있음(2026-08-05, 복수 역할 지원).
  // members/index.js의 INSERT와 같은 필터링 규칙.
  if ('roles' in body) {
    const ALLOWED_ROLES = ['관리자', '부서장', '팀원'];
    const filtered = Array.isArray(body.roles) ? body.roles.filter(r => ALLOWED_ROLES.includes(r) && r !== '팀원') : [];
    sets.push(`roles = $${i++}`); values.push(filtered.length ? filtered : ['팀원']);
  }
  if (body.workType) {
    sets.push(`work_type_name = $${i++}`); values.push(body.workType.name || '');
    sets.push(`work_type_fixed = $${i++}`); values.push(!!body.workType.fixed);
    sets.push(`work_type_hours = $${i++}`); values.push(body.workType.hours || '');
  }
  if (body.leavePolicy) {
    sets.push(`leave_policy_basis = $${i++}`); values.push(body.leavePolicy.basis || '');
    sets.push(`leave_policy_half_day = $${i++}`); values.push(body.leavePolicy.halfDay || '');
    sets.push(`leave_policy_promotion = $${i++}`); values.push(body.leavePolicy.promotion || '');
  }
  if (body.deduction) {
    sets.push(`deduction_basic = $${i++}`); values.push(body.deduction.basic ?? 0);
    sets.push(`deduction_health_dependents = $${i++}`); values.push(body.deduction.healthDependents ?? 0);
  }

  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

  sets.push(`updated_at = now()`);
  values.push(id);

  try {
    const rows = await sql(`UPDATE members SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`, values);
    if (!rows.length) return res.status(404).json({ error: 'Member not found' });
    res.status(200).json({ id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update member' });
  }
}
