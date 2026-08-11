import { sql } from '../_lib/db.js';
import { requireRole } from '../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireRole(req, res, ['ADMIN']))) return;
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const [row] = await sql`
      INSERT INTO jobs (title, team, deadline, status, stages, submission_docs, pre_questions, extra_info)
      VALUES (${b.title}, ${b.team || '-'}, ${b.deadline || null}, '진행중',
        ${JSON.stringify(b.stages || [])}::jsonb,
        ${JSON.stringify(b.submissionDocs || [])}::jsonb,
        ${JSON.stringify(b.preQuestions || [])}::jsonb,
        ${JSON.stringify(b.extraInfo || {})}::jsonb)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create job' });
  }
}
