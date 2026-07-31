import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });
  const { names } = req.body || {};
  if (!Array.isArray(names) || names.length === 0 || names.some(n => typeof n !== 'string' || !n.trim())) {
    return res.status(400).json({ error: 'names must be a non-empty array of non-empty strings' });
  }

  try {
    const queries = [sql`DELETE FROM holidays`];
    for (const name of names) {
      queries.push(sql`INSERT INTO holidays (name) VALUES (${name.trim()})`);
    }
    await sql.transaction(queries);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update holidays' });
  }
}
