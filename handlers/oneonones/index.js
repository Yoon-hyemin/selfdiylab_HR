import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.employeeId) return res.status(400).json({ error: 'employeeId is required' });

  try {
    const [row] = await sql`
      INSERT INTO oneonones (employee_id, date, note)
      VALUES (${b.employeeId}, ${b.date}, ${b.note || '-'})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create one-on-one' });
  }
}
