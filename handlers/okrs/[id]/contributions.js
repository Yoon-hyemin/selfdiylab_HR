/**
 * handlers/okrs/[id]/contributions.js
 *
 * POST { contributions: [{ team, contribution }] } -> 200 { ok: true }
 *
 * 2026-08-12: 기업 목표 하나에 연결된 부서들의 "부서 기여도"를 관리자가
 * 직접 설정한다. 합계가 정확히 100이어야 저장을 허용한다(같은 레벨 안에서
 * 가중치/기여도 합 100% 강제라는 이 프로젝트의 기존 관례와 동일). team은
 * 실제로 이 기업 목표에 연결된(okrs.parent_id로 이어진 조직 목표가 있는)
 * 부서인지 검증한다 -- 하드코딩된 부서 목록을 쓰지 않는다.
 *
 * 저장은 전체 교체 방식이다(DELETE 후 INSERT) -- 한 번에 그 기업 목표의
 * 기여도 셋 전체를 다시 정의한다는 의미라 부분 업데이트 개념이 없다.
 */
import { sql } from '../../_lib/db.js';
import { requireRole } from '../../_lib/accountAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const { id } = req.query;
  const { contributions } = req.body || {};
  if (!Array.isArray(contributions) || !contributions.length) {
    return res.status(400).json({ error: '부서 기여도를 입력해주세요' });
  }

  try {
    const [company] = await sql`SELECT id, level FROM okrs WHERE id = ${id}`;
    if (!company || company.level !== '회사') return res.status(400).json({ error: '기업 목표에만 부서 기여도를 설정할 수 있어요' });

    const connectedTeams = await sql`SELECT DISTINCT owner FROM okrs WHERE level = '조직' AND parent_id = ${id}`;
    const connectedSet = new Set(connectedTeams.map(r => r.owner));

    let sum = 0;
    const rows = [];
    for (const c of contributions) {
      const team = String(c.team || '').trim();
      const contribution = Number(c.contribution);
      if (!team) return res.status(400).json({ error: '부서명이 비어 있어요' });
      if (!connectedSet.has(team)) return res.status(400).json({ error: `${team}은 이 기업 목표에 연결된 부서가 아니에요` });
      if (!Number.isInteger(contribution) || contribution < 0 || contribution > 100) {
        return res.status(400).json({ error: '부서 기여도는 0~100 사이 정수여야 해요' });
      }
      sum += contribution;
      rows.push({ team, contribution });
    }
    if (sum !== 100) return res.status(400).json({ error: `부서 기여도 합계가 100%가 아니에요 (현재 ${sum}%)` });

    await sql`DELETE FROM company_goal_dept_contributions WHERE company_okr_id = ${id}`;
    for (const r of rows) {
      await sql`INSERT INTO company_goal_dept_contributions (company_okr_id, team, contribution) VALUES (${id}, ${r.team}, ${r.contribution})`;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save contributions' });
  }
}
