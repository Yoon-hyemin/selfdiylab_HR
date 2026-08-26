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
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { project_detail_out } from '../_lib/talentSearchProject.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  try {
    const [row] = await sql`SELECT * FROM talent_search_projects WHERE id = ${id}`;
    if (!row) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
    return res.status(200).json(project_detail_out(row));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '검색 프로젝트를 불러오지 못했어요' });
  }
}
