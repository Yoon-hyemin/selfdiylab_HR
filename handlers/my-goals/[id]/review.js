/**
 * handlers/my-goals/[id]/review.js
 *
 * PATCH { status:'approved'|'rejected', reviewNote? } -> 200 { ok: true }
 *
 * 2026-08-06: 부서장이 팀원의 개인 목표를 승인/반려하는 엔드포인트. 대상
 * 팀원 본인이 아니라 그 개인 목표가 연결된 부서 목표의 담당팀(owner) 소속
 * 부서장만 호출할 수 있다 -- handlers/okrs/index.js의 "부서장이면서 본인
 * 팀"과 같은 권한 패턴이다.
 *
 * 반려할 때는 reviewNote(반려 사유)를 필수로 받는다 -- 사유 없이 반려만
 * 남으면 팀원이 뭘 고쳐야 할지 알 수 없기 때문이다. 승인할 때는
 * reviewNote를 비워서 이전 반려 사유를 지운다.
 *
 * 승인/반려 모두 목표 자체를 지우거나 잠그지 않는다 -- 반려된 목표도 그대로
 * 남아있고, 팀원이 제목/체크리스트를 고친 뒤 부서장이 다시 승인할 수 있다
 * (재검토에 별도 절차가 없다: 이 엔드포인트를 다시 호출하면 그만이다).
 *
 * 2026-08-06(부서목표 화면 재설계): 관리자는 팀 소속과 무관하게 아무 개인
 * 목표나 검토할 수 있다("대표·관리자: 개인 목표 승인" 요구사항). 부서장은
 * 여전히 본인 팀 것만 가능하다.
 */
import { sql } from '../../_lib/db.js';
import { getSessionMemberId } from '../../_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const memberId = getSessionMemberId(req);
  if (!memberId) return res.status(401).json({ error: '로그인이 필요해요' });

  const { id } = req.query;
  const status = req.body && req.body.status;
  const reviewNote = (req.body && req.body.reviewNote || '').trim();
  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: 'status는 approved 또는 rejected여야 해요' });
  }
  if (status === 'rejected' && !reviewNote) {
    return res.status(400).json({ error: '반려할 때는 사유를 입력해주세요' });
  }

  try {
    const [okr] = await sql`SELECT id, level, parent_id FROM okrs WHERE id = ${id}`;
    if (!okr) return res.status(404).json({ error: '목표를 찾을 수 없어요' });
    if (okr.level !== '개인') return res.status(400).json({ error: '개인 목표만 검토할 수 있어요' });

    const [parent] = await sql`SELECT owner FROM okrs WHERE id = ${okr.parent_id}`;
    if (!parent) return res.status(400).json({ error: '연결된 부서 목표를 찾을 수 없어요' });

    const [me] = await sql`SELECT roles, team FROM members WHERE id = ${memberId}`;
    if (!me) return res.status(401).json({ error: '로그인이 필요해요' });
    const roles = me.roles || [];
    if (!roles.includes('관리자')) {
      if (!roles.includes('부서장')) return res.status(403).json({ error: '부서장만 검토할 수 있어요' });
      if (me.team !== parent.owner) return res.status(403).json({ error: '본인 팀의 개인 목표만 검토할 수 있어요' });
    }

    await sql`UPDATE okrs SET status = ${status}, review_note = ${status === 'rejected' ? reviewNote : ''} WHERE id = ${okr.id}`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to review goal' });
  }
}
