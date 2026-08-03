import { randomUUID } from 'node:crypto';
import { sql } from '../../_lib/db.js';

const MAX_NAME = 200;
const MAX_PHONE = 50;
const MAX_EMAIL = 254;
const MAX_SELF_INTRO = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id: jobId } = req.query;
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'name is required' });
  if (b.name.length > MAX_NAME) return res.status(400).json({ error: `name must be ${MAX_NAME} characters or fewer` });
  if (b.phone && b.phone.length > MAX_PHONE) return res.status(400).json({ error: `phone must be ${MAX_PHONE} characters or fewer` });
  if (b.email && b.email.length > MAX_EMAIL) return res.status(400).json({ error: `email must be ${MAX_EMAIL} characters or fewer` });
  if (b.selfIntro && b.selfIntro.length > MAX_SELF_INTRO) return res.status(400).json({ error: `selfIntro must be ${MAX_SELF_INTRO} characters or fewer` });
  if (b.email && b.email.trim() && !EMAIL_RE.test(b.email.trim())) return res.status(400).json({ error: 'email is not a valid email address' });

  try {
    const [job] = await sql`SELECT stages, status FROM jobs WHERE id = ${jobId}`;
    // Don't distinguish "job doesn't exist" from "job exists but isn't open" --
    // both return 404 so a closed job's UUID can't be confirmed by probing.
    if (!job || job.status !== '진행중') return res.status(404).json({ error: 'Job not found' });
    const firstStage = job.stages[0] || '접수';

    const candidateId = randomUUID();
    await sql.transaction([
      sql`INSERT INTO candidates (id, job_id, name, phone, email, self_intro, stage)
          VALUES (${candidateId}, ${jobId}, ${b.name}, ${b.phone || '-'}, ${b.email || null}, ${b.selfIntro || null}, ${firstStage})`,
      sql`INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES (${candidateId}, current_date, ${firstStage}, '지원서 접수')`
    ]);

    res.status(201).json({ id: candidateId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create candidate' });
  }
}
