import { sql } from '../../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: jobId } = req.query;
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });

  try {
    const [job] = await sql`SELECT stages FROM jobs WHERE id = ${jobId}`;
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const firstStage = job.stages[0] || '접수';

    const [candidate] = await sql`
      INSERT INTO candidates (job_id, name, phone, email, self_intro, stage)
      VALUES (${jobId}, ${b.name}, ${b.phone || '-'}, ${b.email || null}, ${b.selfIntro || null}, ${firstStage})
      RETURNING id`;

    await sql`INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES (${candidate.id}, current_date, ${firstStage}, '지원서 접수')`;

    res.status(201).json({ id: candidate.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create candidate' });
  }
}
