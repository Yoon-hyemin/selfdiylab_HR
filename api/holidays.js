import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { names } = req.body || {};
  if (!Array.isArray(names)) return res.status(400).json({ error: 'names must be an array' });

  try {
    await sql`DELETE FROM holidays`;
    for (const name of names) {
      await sql`INSERT INTO holidays (name) VALUES (${name})`;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update holidays' });
  }
}
