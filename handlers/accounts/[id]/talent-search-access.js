/**
 * handlers/accounts/[id]/talent-search-access.js
 *
 * PATCH { canUseTalentSearch: boolean } -> 200 { account }
 *
 * "인재검색" 메뉴는 accounts.system_role과 별개 축인 이 플래그로 노출
 * 여부가 결정된다(ADMIN은 이 값과 무관하게 항상 접근 가능 -- 프론트
 * index.html의 applySidebarForRole에서 처리). 여기서는 단순히 플래그
 * 값을 켜고 끄는 것만 담당하고, 마지막 ADMIN 보호 같은 특수 규칙은
 * 없다(이 플래그를 끈다고 로그인 자체가 막히거나 다른 권한이 줄어들지
 * 않으므로 accounts/[id]/status.js 같은 안전장치가 필요 없다).
 * 다른 accounts/[id] 계열 핸들러(예: status.js)는 권한이 바뀔 때
 * session_version을 올려 기존 세션을 강제로 갱신시키지만, 여기서는
 * 그러지 않는다 -- 지금은 이 플래그 뒤에 아무 것도 없어서(서버 API가
 * 이 값을 검사하지 않음, 위 다른 파일들의 주석 참고) 즉시 반영이 안 돼도
 * 실질적 위험이 없기 때문이다. 서버 사이드 검사가 생기면(Phase 1B) 이
 * 선택을 다시 검토할 것.
 */
import { sql } from '../../_lib/db.js';
import { requireRole } from '../../_lib/accountAuth.js';
import { writeAuditLog, account_out } from '../../_lib/accountAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireRole(req, res, ['ADMIN']);
  if (!admin) return;

  const { id } = req.query;
  const { canUseTalentSearch } = req.body || {};
  if (typeof canUseTalentSearch !== 'boolean') return res.status(400).json({ error: '값이 올바르지 않아요' });

  try {
    const [target] = await sql`
      SELECT a.*, m.name AS employee_name, m.team AS employee_team
      FROM accounts a JOIN members m ON m.id = a.employee_id WHERE a.id = ${id}`;
    if (!target) return res.status(404).json({ error: '계정을 찾을 수 없어요' });

    const [updated] = await sql`
      UPDATE accounts SET can_use_talent_search = ${canUseTalentSearch}, updated_at = now()
      WHERE id = ${id} RETURNING *`;
    await writeAuditLog(admin.id, id, 'TALENT_SEARCH_ACCESS_CHANGE', { canUseTalentSearch });

    return res.status(200).json({ account: account_out({ ...updated, employee_name: target.employee_name, employee_team: target.employee_team }) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '권한 변경에 실패했어요' });
  }
}
