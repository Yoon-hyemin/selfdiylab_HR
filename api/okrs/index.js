import { sql } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const [row] = await sql`
      INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target)
      VALUES (${b.quarter || '2026-Q3'}, ${b.level || '개인'}, ${b.title}, ${b.owner || '-'}, ${b.parent || null}, ${b.progress || 0}, ${b.unit || '%'}, ${b.target || 100})
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OKR' });
  }
}
