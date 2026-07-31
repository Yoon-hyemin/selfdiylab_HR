import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { progress } = req.body || {};
  if (progress === undefined) return res.status(400).json({ error: 'progress is required' });

  try {
    const rows = await sql`UPDATE okrs SET progress = ${Number(progress)} WHERE id = ${id} RETURNING id`;
    if (!rows.length) return res.status(404).json({ error: 'OKR not found' });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update OKR' });
  }
}
