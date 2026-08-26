/**
 * handlers/talent-search-projects/[id].js
 *
 * GET -> 200 { id, title, roleTitle, seniorityLevel, experienceMinYears,
 *              experienceMaxYears, employmentType, headcount, location,
 *              workConditions, naturalLanguageBrief, keywords, clarificationNotes,
 *              targetRecommendCount, dailyRecommendCap, platforms, status,
 *              createdAt, updatedAt } | 404
 *
 * Phase 1D-1: 검색 프로젝트 상세 조회. 목록(GET /api/talent-search-projects,
 * handlers/talent-search-projects/index.js)이 가벼운 필드만 내려주는 것과
 * 달리, 검토 화면에서만 필요한 무거운 필드(keywords/workConditions/
 * naturalLanguageBrief/clarificationNotes)까지 전부 내려준다.
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';

function project_detail_out(row) {
  return {
    id: row.id,
    title: row.title,
    roleTitle: row.role_title,
    seniorityLevel: row.seniority_level,
    experienceMinYears: row.experience_min_years,
    experienceMaxYears: row.experience_max_years,
    employmentType: row.employment_type,
    headcount: row.headcount,
    location: row.location,
    workConditions: row.work_conditions,
    naturalLanguageBrief: row.natural_language_brief,
    keywords: row.keywords,
    clarificationNotes: row.clarification_notes,
    targetRecommendCount: row.target_recommend_count,
    dailyRecommendCap: row.daily_recommend_cap,
    platforms: row.platforms,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

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
