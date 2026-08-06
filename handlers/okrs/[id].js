/**
 * handlers/okrs/[id].js
 *
 * PATCH { title } -> 200 { ok: true }   회사/부서 목표 제목 수정
 * DELETE          -> 200 { ok: true }   회사/부서 목표 삭제
 *
 * 2026-08-06: 목표를 한번 만들면 고치거나 지울 방법이 없던 걸 채워 넣는다.
 * 권한은 생성 때와 동일하다 — 회사 목표는 roles에 '관리자'가 있는 사람만,
 * 부서 목표는 roles에 '부서장'이 있으면서 그 팀(owner) 소속인 사람만. 개인
 * 목표는 이 엔드포인트에서 다루지 않는다(handlers/my-goals/[id].js 참고).
 *
 * 삭제 시 하위 목표(조직 목표를 상위로 둔 개인 목표, 회사 목표를 상위로 둔
 * 조직 목표)는 지우지 않는다 — sql/001_schema.sql의 okrs.parent_id가
 * ON DELETE SET NULL이라 하위 목표는 그대로 남고 상위 연결만 끊긴다(개인
 * 목표라면 본인 "개인 목표" 탭에 계속 보인다).
 *
 * 수정/삭제 모두 생성과 같은 "이번 달/지난달" 제한을 적용한다 — 그보다 오래된
 * 목표는 조회만 가능하다는 프로젝트 전체 규칙과 일관되게 유지하기 위해서다.
 */
import { sql } from '../_lib/db.js';
import { getSessionMemberId } from '../_lib/memberSession.js';
import { isEditableMonth } from '../_lib/monthWindow.js';

async function loadOkrAndCheckPermission(id, memberId) {
  const [okr] = await sql`SELECT id, level, owner, month FROM okrs WHERE id = ${id}`;
  if (!okr) return { error: [404, '목표를 찾을 수 없어요'] };
  if (okr.level === '개인') return { error: [400, '개인 목표는 /api/my-goals로 수정/삭제해주세요'] };

  const [me] = await sql`SELECT roles, team FROM members WHERE id = ${memberId}`;
  if (!me) return { error: [401, '로그인이 필요해요'] };
  const roles = me.roles || [];

  if (okr.level === '회사' && !roles.includes('관리자')) {
    return { error: [403, '회사 목표는 관리자만 수정/삭제할 수 있어요'] };
  }
  if (okr.level === '조직') {
    if (!roles.includes('부서장')) return { error: [403, '부서 목표는 부서장만 수정/삭제할 수 있어요'] };
    if (okr.owner !== me.team) return { error: [403, '본인 팀 목표만 수정/삭제할 수 있어요'] };
  }
  if (!isEditableMonth(okr.month)) return { error: [400, '이번 달/지난달 목표만 수정/삭제할 수 있어요'] };

  return { okr };
}

export default async function handler(req, res) {
  const { id } = req.query;
  const memberId = getSessionMemberId(req);
  if (!memberId) return res.status(401).json({ error: '로그인이 필요해요' });

  try {
    const { okr, error } = await loadOkrAndCheckPermission(id, memberId);
    if (error) return res.status(error[0]).json({ error: error[1] });

    if (req.method === 'PATCH') {
      const title = (req.body && req.body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title is required' });
      await sql`UPDATE okrs SET title = ${title} WHERE id = ${okr.id}`;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM okrs WHERE id = ${okr.id}`;
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update OKR' });
  }
}
