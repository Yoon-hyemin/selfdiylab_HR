/**
 * handlers/okrs/index.js
 *
 * POST { level:'회사', title, quarter } -> 201 { id }
 * POST { level:'조직', title, month, parent, owner } -> 201 { id }
 *
 * 개인(level:'개인') 목표는 여기서 만들지 않는다 — 로그인한 본인 명의로만
 * 만들어져야 하므로 /api/my-goals를 쓴다(handlers/my-goals/index.js).
 *
 * 부서(조직) 목표는 반드시 기업(회사) 목표를 상위로 선택해야 하고, 같은
 * 팀(owner)·같은 달(month)에 3개를 넘게 만들 수 없다.
 */
import { sql } from '../_lib/db.js';

// '2026-08' -> '2026-Q3'
function quarterFromMonth(month) {
  const [year, m] = month.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${year}-Q${q}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
  if (b.level === '개인') return res.status(400).json({ error: '개인 목표는 /api/my-goals로 만들어주세요' });
  if (b.level !== '회사' && b.level !== '조직') return res.status(400).json({ error: 'level must be 회사 or 조직' });

  try {
    if (b.level === '조직') {
      if (!b.month) return res.status(400).json({ error: '월을 선택해주세요' });
      if (!b.parent) return res.status(400).json({ error: '상위 기업 목표를 선택해주세요' });

      const [parent] = await sql`SELECT id, level FROM okrs WHERE id = ${b.parent}`;
      if (!parent || parent.level !== '회사') {
        return res.status(400).json({ error: '상위 목표는 기업 목표여야 해요' });
      }

      const owner = (b.owner || '-').trim() || '-';
      const [{ count }] = await sql`
        SELECT count(*)::int AS count FROM okrs
        WHERE level = '조직' AND owner = ${owner} AND month = ${b.month}`;
      if (count >= 3) {
        return res.status(400).json({ error: `${owner} 팀은 ${b.month}에 이미 목표가 3개 있어요` });
      }

      const [row] = await sql`
        INSERT INTO okrs (quarter, month, level, title, owner, parent_id, progress, unit, target)
        VALUES (${quarterFromMonth(b.month)}, ${b.month}, '조직', ${b.title.trim()}, ${owner}, ${b.parent}, 0, '%', 100)
        RETURNING id`;
      return res.status(201).json({ id: row.id });
    }

    // 회사
    const [row] = await sql`
      INSERT INTO okrs (quarter, level, title, owner, progress, unit, target)
      VALUES (${b.quarter || '2026-Q3'}, '회사', ${b.title.trim()}, '전사', 0, '%', 100)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OKR' });
  }
}
