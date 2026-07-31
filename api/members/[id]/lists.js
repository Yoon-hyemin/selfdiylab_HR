import { sql } from '../../_lib/db.js';

const KNOWN_LISTS = ['leaveHistory', 'awards', 'discipline', 'career', 'education', 'family'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { id } = req.query;
  const { list, item } = req.body || {};
  if (!KNOWN_LISTS.includes(list)) return res.status(400).json({ error: 'Unknown list: ' + list });

  try {
    if (list === 'leaveHistory') {
      await sql`INSERT INTO member_leave_history (member_id, reason, period) VALUES (${id}, ${item.reason || ''}, ${item.period || ''})`;
    } else if (list === 'awards') {
      await sql`INSERT INTO member_awards (member_id, title, date) VALUES (${id}, ${item.title || ''}, ${item.date || null})`;
    } else if (list === 'discipline') {
      await sql`INSERT INTO member_discipline (member_id, reason, date) VALUES (${id}, ${item.reason || ''}, ${item.date || null})`;
    } else if (list === 'career') {
      await sql`INSERT INTO member_career (member_id, company, role, period) VALUES (${id}, ${item.company || ''}, ${item.role || ''}, ${item.period || ''})`;
    } else if (list === 'education') {
      await sql`INSERT INTO member_education (member_id, school, major, period) VALUES (${id}, ${item.school || ''}, ${item.major || ''}, ${item.period || ''})`;
    } else if (list === 'family') {
      await sql`INSERT INTO member_family (member_id, name, relation) VALUES (${id}, ${item.name || ''}, ${item.relation || ''})`;
      await sql`UPDATE members SET deduction_basic = (SELECT COUNT(*) FROM member_family WHERE member_id = ${id}) + 1 WHERE id = ${id}`;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add list item' });
  }
}
