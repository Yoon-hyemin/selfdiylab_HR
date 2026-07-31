import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: 'stage is required' });

  try {
    const rows = await sql`UPDATE candidates SET stage = ${stage} WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'Candidate not found' });
    await sql`INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES (${id}, current_date, ${stage}, ${stage + ' 단계로 변경'})`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update candidate' });
  }
}
