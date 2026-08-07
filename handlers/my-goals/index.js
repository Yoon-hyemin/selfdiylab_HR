/**
 * handlers/my-goals/index.js
 *
 * POST { parentId, title, weight? } -> 201 { id }
 *
 * 개인(레벨='개인') 목표 생성 전용 엔드포인트. /api/okrs는 이 레벨을
 * 거부한다 — 개인 목표는 반드시 로그인한 본인 명의로만 만들어져야 하므로
 * 세션에서 얻은 memberId를 그대로 소유자로 쓴다(요청 바디의 소유자는
 * 받지 않음). quarter/month는 상위(부서) 목표에서 그대로 상속한다.
 *
 * 2026-08-04: 상위 부서 목표가 로그인한 본인의 팀 소속인지 확인하는 검증을
 * 추가했다 — 이전에는 다른 팀의 부서 목표에도 개인 목표를 붙일 수 있었다.
 * 상위 부서 목표의 월이 이번 달/지난달이 아니면 거부한다.
 *
 * 2026-08-06: 개인 목표는 만들 때 status='pending'으로 시작한다 — 부서장이
 * 검토(승인/반려)할 수 있게 하기 위해서다(PATCH /api/my-goals/:id/review,
 * handlers/my-goals/[id]/review.js). 승인 전엔 프론트에서 체크리스트를
 * 잠가둔다. 회사/조직 레벨은 이 검토 흐름 대상이 아니라서 okrs.status
 * 컬럼의 기본값(approved)을 그대로 쓴다.
 *
 * 2026-08-06(부서목표 화면 재설계): 가중치(weight)도 받는다. 사용자가 정의한
 * 매커니즘상 개인 목표는 "그 사람·그 달" 단위로 가중치 합이 100%를 넘을 수
 * 없다(회사/부서처럼 팀 단위가 아니라 개인 단위 스코프라는 점이 다르다).
 *
 * 2026-08-06(개인목표 화면 재설계): status 기본값을 'pending'에서 'draft'로
 * 바꿨다 — 만들자마자 바로 부서장 검토 대기열에 뜨는 대신, 본인이 가중치를
 * 다듬은 뒤 명시적으로 "승인 요청"을 눌러야 pending으로 넘어간다
 * (PATCH /api/my-goals/:id/submit, handlers/my-goals/[id]/submit.js). 또한
 * 이번 달 개인 목표를 최대 10개로 제한한다(화면 시안에서 명시된 값).
 */
import { sql } from '../_lib/db.js';
import { requireMemberAuth } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

function parseWeight(raw) {
  if (raw === undefined || raw === null || raw === '') return { weight: null };
  const w = Number(raw);
  if (!Number.isInteger(w) || w < 0 || w > 100) return { error: '가중치는 0~100 사이 정수여야 해요' };
  return { weight: w };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  const { parentId, title, weight: rawWeight } = req.body || {};
  if (!parentId) return res.status(400).json({ error: '연결할 부서 목표를 선택해주세요' });
  if (!title || !title.trim()) return res.status(400).json({ error: 'title is required' });
  const { weight, error: weightErr } = parseWeight(rawWeight);
  if (weightErr) return res.status(400).json({ error: weightErr });

  try {
    const [me] = await sql`SELECT team FROM members WHERE id = ${memberId}`;
    const [parent] = await sql`SELECT id, quarter, month, level, owner FROM okrs WHERE id = ${parentId}`;
    if (!parent || parent.level !== '조직') {
      return res.status(400).json({ error: '상위 목표는 부서 목표여야 해요' });
    }
    if (!me || parent.owner !== me.team) {
      return res.status(403).json({ error: '본인 팀의 부서 목표에만 연결할 수 있어요' });
    }
    if (!isEditableMonth(parent.month)) {
      return res.status(400).json({ error: '이번 달/지난달 부서 목표에만 연결할 수 있어요' });
    }

    const [{ count }] = await sql`SELECT count(*)::int AS count FROM okrs WHERE level = '개인' AND member_id = ${memberId} AND month = ${parent.month}`;
    if (count >= 10) {
      return res.status(400).json({ error: `${parent.month}에는 이미 개인 목표가 10개 있어요 (최대 10개)` });
    }

    if (weight !== null) {
      const [{ sum }] = await sql`
        SELECT COALESCE(SUM(weight), 0)::int AS sum FROM okrs
        WHERE level = '개인' AND member_id = ${memberId} AND month = ${parent.month} AND weight IS NOT NULL`;
      if (sum + weight > 100) {
        return res.status(400).json({ error: `이번 달 내 개인 목표 가중치 합계가 100%를 넘어요 (현재 ${sum}% + ${weight}%)` });
      }
    }

    const [row] = await sql`
      INSERT INTO okrs (quarter, month, level, title, owner, parent_id, member_id, weight, progress, unit, target, status)
      VALUES (${parent.quarter}, ${parent.month}, '개인', ${title.trim()}, '-', ${parent.id}, ${memberId}, ${weight}, 0, '%', 100, 'draft')
      RETURNING id`;
    res.status(201).json({ id: row.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
}
