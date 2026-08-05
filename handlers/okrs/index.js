/**
 * handlers/okrs/index.js
 *
 * POST { level:'회사', title, month } -> 201 { id }
 * POST { level:'조직', title, month, parent, owner, part } -> 201 { id }
 *
 * 개인(level:'개인') 목표는 여기서 만들지 않는다 — 로그인한 본인 명의로만
 * 만들어져야 하므로 /api/my-goals를 쓴다(handlers/my-goals/index.js).
 *
 * 2026-08-04: 지금까지 이 엔드포인트는 로그인 여부와 무관하게 누구나 호출할
 * 수 있었다. 목표 탭을 역할(관리자/부서장/팀원) 기반으로 재설계하면서 실제
 * 권한 검사를 추가한다 — 회사 목표는 role='관리자'만, 부서 목표는
 * role='부서장'이면서 그 팀 소속인 사람만 만들 수 있다
 * (docs/superpowers/specs/2026-08-04-goal-tab-role-permissions-design.md 참고).
 *
 * 부서(조직) 목표는 반드시 "같은 달"의 기업(회사) 목표를 상위로 선택해야
 * 하고, 같은 팀(owner)·같은 달(month)·같은 파트(part)에 5개를 넘게 만들 수
 * 없다. part는 한 팀 안에 기능이 나뉘는 경우(예: 인사회계팀의 인사/회계)를
 * 위한 자유 텍스트 태그로, 없으면 빈 문자열이다.
 *
 * 회사/부서 목표 모두 "이번 달 또는 지난달"만 만들 수 있다(isEditableMonth).
 */
import { sql } from '../_lib/db.js';
import { getSessionMemberId } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

// '2026-08' -> '2026-Q3'
function quarterFromMonth(month) {
  const [year, m] = month.split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  return `${year}-Q${q}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const memberId = getSessionMemberId(req);
  if (!memberId) return res.status(401).json({ error: '로그인이 필요해요' });

  const b = req.body || {};
  if (!b.title || !b.title.trim()) return res.status(400).json({ error: 'title is required' });
  if (b.level === '개인') return res.status(400).json({ error: '개인 목표는 /api/my-goals로 만들어주세요' });
  if (b.level !== '회사' && b.level !== '조직') return res.status(400).json({ error: 'level must be 회사 or 조직' });
  if (!b.month) return res.status(400).json({ error: '월을 선택해주세요' });
  if (!isEditableMonth(b.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 만들 수 있어요' });

  try {
    // 세션 검사(getSessionMemberId)는 DB에 접근하지 않지만, 이 조회는 접근하므로
    // try 안에서 실행해 일시적인 DB 오류도 나머지 코드와 같은 500 JSON 응답으로
    // 처리되게 한다(전에는 try 시작 전에 있어서 그런 오류가 처리 안 된 예외로
    // 튀어나갔다).
    const [me] = await sql`SELECT role, team FROM members WHERE id = ${memberId}`;
    if (!me) return res.status(401).json({ error: '로그인이 필요해요' });

    if (b.level === '조직') {
      if (me.role !== '부서장') return res.status(403).json({ error: '부서 목표는 부서장만 만들 수 있어요' });

      const owner = (b.owner || '-').trim() || '-';
      if (owner !== me.team) return res.status(403).json({ error: '본인 팀 목표만 만들 수 있어요' });

      if (!b.parent) return res.status(400).json({ error: '상위 기업 목표를 선택해주세요' });
      const [parent] = await sql`SELECT id, level, month FROM okrs WHERE id = ${b.parent}`;
      if (!parent || parent.level !== '회사') {
        return res.status(400).json({ error: '상위 목표는 기업 목표여야 해요' });
      }
      if (parent.month !== b.month) {
        return res.status(400).json({ error: '상위 기업 목표와 같은 달로 맞춰주세요' });
      }

      const part = (b.part || '').trim();
      const [{ count }] = await sql`
        SELECT count(*)::int AS count FROM okrs
        WHERE level = '조직' AND owner = ${owner} AND month = ${b.month} AND part = ${part}`;
      if (count >= 5) {
        return res.status(400).json({ error: `${owner}${part ? ' · ' + part : ''} 팀은 ${b.month}에 이미 목표가 5개 있어요` });
      }

      const [row] = await sql`
        INSERT INTO okrs (quarter, month, level, title, owner, parent_id, part, progress, unit, target)
        VALUES (${quarterFromMonth(b.month)}, ${b.month}, '조직', ${b.title.trim()}, ${owner}, ${b.parent}, ${part}, 0, '%', 100)
        RETURNING id`;
      return res.status(201).json({ id: row.id });
    }

    // 회사
    if (me.role !== '관리자') return res.status(403).json({ error: '회사 목표는 관리자만 만들 수 있어요' });
    const [row] = await sql`
      INSERT INTO okrs (quarter, month, level, title, owner, progress, unit, target)
      VALUES (${quarterFromMonth(b.month)}, ${b.month}, '회사', ${b.title.trim()}, '전사', 0, '%', 100)
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create OKR' });
  }
}
