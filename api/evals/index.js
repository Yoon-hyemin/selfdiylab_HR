import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.employeeId) return res.status(400).json({ error: 'employeeId is required' });

  try {
    const [row] = await sql`
      INSERT INTO evals (quarter, employee_id, common, lead, job, performance, custom, strength, improve)
      VALUES (${b.quarter || '2026-Q2'}, ${b.employeeId}, ${b.common}, ${b.lead}, ${b.job}, ${b.performance}, ${b.custom}, ${b.strength || '-'}, ${b.improve || '-'})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create eval' });
  }
}
