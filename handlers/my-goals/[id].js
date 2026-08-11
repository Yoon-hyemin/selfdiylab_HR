/**
 * handlers/my-goals/[id].js
 *
 * PATCH { title, weight? } -> 200 { ok: true }   개인 목표 제목·가중치 수정
 * DELETE                   -> 200 { ok: true }   개인 목표 삭제
 *
 * 2026-08-06: handlers/okrs/[id].js와 짝을 이루는 개인 목표용 수정/삭제
 * 엔드포인트. 권한은 딱 하나 — 로그인한 본인이 만든(member_id 일치) 목표만
 * 고치거나 지울 수 있다. 다른 사람의 개인 목표는 관리자든 부서장이든 손댈 수
 * 없다(생성 때부터 본인 명의로만 만들어지는 것과 대칭).
 *
 * 삭제해도 하위 체크리스트(okr_tasks)는 ON DELETE CASCADE로 같이 지워진다.
 *
 * 2026-08-06(부서목표 화면 재설계): 승인된(status='approved') 개인 목표의
 * 제목이나 가중치를 고치면 자동으로 status='pending'으로 되돌아간다 —
 * 사용자가 정의한 매커니즘의 "핵심 정보를 수정하면 재승인 대기로" 규칙.
 * 체크리스트 체크/추가/삭제는 이 엔드포인트가 아니라 handlers/okr-tasks/*가
 * 처리하므로 재승인 트리거 대상이 아니다(의도된 분리).
 */
import { sql } from '../_lib/db.js';
import { requireEmployeeAuth } from '../_lib/accountAuth.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

function parseWeight(raw) {
  if (raw === undefined || raw === null || raw === '') return { weight: null };
  const w = Number(raw);
  if (!Number.isInteger(w) || w < 0 || w > 100) return { error: '가중치는 0~100 사이 정수여야 해요' };
  return { weight: w };
}

export default async function handler(req, res) {
  const memberId = await requireEmployeeAuth(req, res);
  if (!memberId) return;

  const { id } = req.query;

  try {
    const [okr] = await sql`SELECT id, level, member_id, parent_id, month, title, weight, status FROM okrs WHERE id = ${id}`;
    if (!okr) return res.status(404).json({ error: '목표를 찾을 수 없어요' });
    if (okr.level !== '개인') return res.status(400).json({ error: '개인 목표가 아니에요' });
    if (okr.member_id !== memberId) return res.status(403).json({ error: '본인이 만든 목표만 수정/삭제할 수 있어요' });
    if (!isEditableMonth(okr.month)) return res.status(400).json({ error: '이번 달/지난달 목표만 수정/삭제할 수 있어요' });

    if (req.method === 'PATCH') {
      const body = req.body || {};
      const title = (body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title is required' });
      const { weight, error: weightErr } = parseWeight(body.weight);
      if (weightErr) return res.status(400).json({ error: weightErr });

      if (weight !== null) {
        const [{ sum }] = await sql`
          SELECT COALESCE(SUM(weight), 0)::int AS sum FROM okrs
          WHERE level = '개인' AND member_id = ${okr.member_id} AND month = ${okr.month} AND weight IS NOT NULL AND id != ${okr.id}`;
        if (sum + weight > 100) {
          return res.status(400).json({ error: `이번 달 내 개인 목표 가중치 합계가 100%를 넘어요 (다른 목표 ${sum}% + ${weight}%)` });
        }
      }

      // 2026-08-11: 상위 부서 목표를 (다시) 연결하는 기능 -- 생성 시 항상
      // 필수였어서 지금 있는 데이터엔 필요 없지만, 부서 목표를 지울 때
      // "연결 해제"를 고른 경우 등을 위해 본인이 직접 다시 연결할 수 있게
      // 열어둔다. 본인 소속 팀의 부서 목표로만 연결 가능하다.
      let newParentId = okr.parent_id;
      if (body.parentId !== undefined) {
        if (body.parentId === null || body.parentId === '') {
          newParentId = null;
        } else {
          const [me] = await sql`SELECT team FROM members WHERE id = ${memberId}`;
          const [newParent] = await sql`SELECT id, level, owner, month FROM okrs WHERE id = ${body.parentId}`;
          if (!newParent || newParent.level !== '조직') return res.status(400).json({ error: '상위 목표는 부서 목표여야 해요' });
          if (!me || newParent.owner !== me.team) return res.status(403).json({ error: '본인 팀의 부서 목표에만 연결할 수 있어요' });
          if (newParent.month !== okr.month) return res.status(400).json({ error: '같은 달의 부서 목표에만 연결할 수 있어요' });
          newParentId = newParent.id;
        }
      }

      const needsReapproval = okr.status === 'approved' && (title !== okr.title || weight !== okr.weight);
      if (needsReapproval) {
        await sql`UPDATE okrs SET title = ${title}, weight = ${weight}, parent_id = ${newParentId}, status = 'pending', review_note = '' WHERE id = ${okr.id}`;
      } else {
        await sql`UPDATE okrs SET title = ${title}, weight = ${weight}, parent_id = ${newParentId} WHERE id = ${okr.id}`;
      }
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM okrs WHERE id = ${okr.id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update goal' });
  }
}
