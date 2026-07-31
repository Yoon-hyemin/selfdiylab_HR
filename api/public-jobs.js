import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const jobs = await sql`SELECT id, title, team, deadline, status FROM jobs WHERE status = '진행중' ORDER BY created_at DESC`;
    res.status(200).json(jobs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
}
