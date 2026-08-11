import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  const { id } = req.query;
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireRole(req, res, ['ADMIN']))) return;
  try {
    await sql`DELETE FROM jobs WHERE id = ${id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete job' });
  }
}
