import { sql } from '../_lib/db.js';
import { requireHrAuth } from '../_lib/hrAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireHrAuth(req, res)) return;
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const [row] = await sql`
      INSERT INTO members (name, team, position, email, phone, hire_date, group_hire_date, hire_type, work_type_name, work_type_fixed, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
      VALUES (${b.name}, ${b.team || ''}, ${b.position || ''}, ${b.email || ''}, ${b.phone || ''}, ${b.hireDate || new Date().toISOString().slice(0,10)}, ${b.groupHireDate || new Date().toISOString().slice(0,10)}, '정규직', '', true, '0시간', '0일', 0, 0)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create member' });
  }
}
