/**
 * handlers/talent-search-projects/[id]/approve.js
 *
 * PATCH {} -> 200 { ...project_detail_out 응답, status:'approved', policyVersionId 채워짐 }
 *
 * Phase 1D-2: "이 조건으로 검색" 승인 액션. status를 draft->approved로
 * 바꾸고, 그 시점의 활성 채점 기준 버전 id를 policy_version_id에 저장해서
 * 영구히 고정한다(이후 기준 관리센터에서 정책이 새 버전으로 바뀌어도 이
 * 값은 안 바뀜). 원본 명세 154행 원칙 그대로 -- 이 버튼을 눌러도 실제
 * 플랫폼 검색은 아직 시작되지 않는다(검색 진행은 1E, 아직 없음). 재승인을
 * 막기 위해 status가 'draft'가 아니면 거부한다.
 */
import { sql } from '../../_lib/db.js';
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { getActivePolicy } from '../../_lib/talentSearchPolicy.js';
import { project_detail_out } from '../../_lib/talentSearchProject.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  try {
    const [project] = await sql`SELECT * FROM talent_search_projects WHERE id = ${id}`;
    if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
    if (project.status !== 'draft') {
      return res.status(400).json({ error: '이미 승인됐거나 승인할 수 없는 상태예요' });
    }

    const activePolicy = await getActivePolicy();
    if (!activePolicy) return res.status(409).json({ error: '적용 중인 채점 기준이 없어요' });

    const [updated] = await sql`
      UPDATE talent_search_projects
      SET status = 'approved', policy_version_id = ${activePolicy.id}, updated_at = now()
      WHERE id = ${id}
      RETURNING *`;
    return res.status(200).json(project_detail_out(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '승인 처리에 실패했어요' });
  }
}
