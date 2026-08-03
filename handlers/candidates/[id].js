import { sql } from '../_lib/db.js';
import { requireHrAuth } from '../_lib/hrAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireHrAuth(req, res)) return;
  const { id } = req.query;
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: 'stage is required' });

  try {
    const [existing] = await sql`SELECT id FROM candidates WHERE id = ${id}`;
    if (!existing) return res.status(404).json({ error: 'Candidate not found' });
    await sql.transaction([
      sql`UPDATE candidates SET stage = ${stage} WHERE id = ${id}`,
      sql`INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES (${id}, current_date, ${stage}, ${stage + ' 단계로 변경'})`
    ]);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update candidate' });
  }
}
