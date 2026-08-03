import { sql } from '../../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { quarter } = req.query;
  const { evalId, grade, reason } = req.body || {};
  if (!evalId || !grade) return res.status(400).json({ error: 'evalId and grade are required' });

  try {
    await sql`INSERT INTO calibration_cycles (quarter) VALUES (${quarter}) ON CONFLICT (quarter) DO NOTHING`;
    await sql`
      INSERT INTO calibration_overrides (quarter, eval_id, grade, reason)
      VALUES (${quarter}, ${evalId}, ${grade}, ${reason || ''})
      ON CONFLICT (quarter, eval_id) DO UPDATE SET grade = EXCLUDED.grade, reason = EXCLUDED.reason`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update calibration override' });
  }
}
