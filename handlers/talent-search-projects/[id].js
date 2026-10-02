/**
 * handlers/talent-search-projects/[id].js
 *
 * GET -> 200 { id, title, roleTitle, seniorityLevel, experienceMinYears,
 *              experienceMaxYears, employmentType, headcount, location,
 *              workConditions, naturalLanguageBrief, keywords, clarificationNotes,
 *              targetRecommendCount, dailyRecommendCap, platforms, status,
 *              policyVersionId, createdAt, updatedAt } | 404
 *
 * Phase 1D-1: 검색 프로젝트 상세 조회. 목록(GET /api/talent-search-projects,
 * handlers/talent-search-projects/index.js)이 가벼운 필드만 내려주는 것과
 * 달리, 검토 화면에서만 필요한 무거운 필드까지 전부 내려준다.
 *
 * Phase 1D-2: 응답 변환 함수(project_detail_out)를 handlers/_lib/
 * talentSearchProject.js로 옮겼다 -- 승인 액션(handlers/talent-search-projects/
 * [id]/approve.js)이 같은 모양의 응답을 돌려줘야 해서 공유가 필요해졌다.
 * 이때 policyVersionId 필드가 추가됐다(승인 전엔 null).
 *
 * DELETE -> 200 { id, title, deletedListCandidates, deletedVirtualCandidates } | 404
 *
 * 2026-10-02 추가: 검색 프로젝트가 너무 많이 쌓여서 목록에서 지울 수
 * 있게 해달라는 요청. 프로젝트에 딸린 후보(가상 후보
 * talent_search_candidates, 실제 후보 리스트 talent_search_list_candidates)는
 * 두 테이블 모두 project_id가 ON DELETE CASCADE라(sql/019, sql/021)
 * 프로젝트 행만 지우면 같이 지워진다 -- 되돌릴 수 없으므로 화면에서
 * 몇 명이 같이 지워지는지 먼저 보여주고 확인받는다(index.html의
 * openDeleteTalentSearchProjectModal). 권한은 조회·생성과 같은
 * requireTalentSearchAccess(이 기능 전체가 ADMIN 전용이 아니라는 기존
 * 원칙과 동일).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { project_detail_out } from '../_lib/talentSearchProject.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  if (req.method === 'DELETE') {
    try {
      // 지우기 전에 딸린 후보 수를 세어 둔다 -- CASCADE로 같이 지워진 뒤에는
      // 셀 수 없어서, 화면에 "몇 명이 같이 지워졌는지" 알려주려면 먼저 세야 한다.
      const [counts] = await sql`
        SELECT
          (SELECT count(*) FROM talent_search_list_candidates WHERE project_id = ${id})::int AS list_count,
          (SELECT count(*) FROM talent_search_candidates WHERE project_id = ${id})::int AS virtual_count`;
      const [deleted] = await sql`DELETE FROM talent_search_projects WHERE id = ${id} RETURNING id, title`;
      if (!deleted) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
      return res.status(200).json({
        id: deleted.id,
        title: deleted.title,
        deletedListCandidates: counts ? counts.list_count : 0,
        deletedVirtualCandidates: counts ? counts.virtual_count : 0
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '검색 프로젝트를 삭제하지 못했어요' });
    }
  }

  try {
    const [row] = await sql`SELECT * FROM talent_search_projects WHERE id = ${id}`;
    if (!row) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
    return res.status(200).json(project_detail_out(row));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '검색 프로젝트를 불러오지 못했어요' });
  }
}
