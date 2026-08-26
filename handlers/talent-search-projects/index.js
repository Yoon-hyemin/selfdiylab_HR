/**
 * handlers/talent-search-projects/index.js
 *
 * GET  -> 200 { projects: [{ id, title, roleTitle, seniorityLevel,
 *              employmentType, headcount, location, targetRecommendCount,
 *              dailyRecommendCap, platforms, status, createdAt }] } (최신순 전체)
 * POST { title, roleTitle, seniorityLevel?, experienceMinYears?, experienceMaxYears?,
 *        employmentType, headcount, location?, workConditions?, naturalLanguageBrief?,
 *        keywords?: {include,or,exact,exclude,preferred}, targetRecommendCount,
 *        platforms: string[], clarificationNotes?: [{question,answer}] }
 *   -> 201 { id }
 *
 * Phase 1C에서 POST만 만들었고(검색 프로젝트를 실제로 만드는 첫 엔드포인트,
 * status는 항상 'draft'로 시작) 목록 조회는 없었다. Phase 1D-1에서 GET을
 * 추가한다 -- 대시보드 카드 목록용으로 가벼운 필드만 내려준다(keywords/
 * workConditions/naturalLanguageBrief/clarificationNotes 같은 무거운 필드는
 * 상세 조회, handlers/talent-search-projects/[id].js에서만 내려줌).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { validateTalentSearchProjectInput } from '../_lib/talentSearchProjectValidate.js';

function project_summary_out(row) {
  return {
    id: row.id,
    title: row.title,
    roleTitle: row.role_title,
    seniorityLevel: row.seniority_level,
    employmentType: row.employment_type,
    headcount: row.headcount,
    location: row.location,
    targetRecommendCount: row.target_recommend_count,
    dailyRecommendCap: row.daily_recommend_cap,
    platforms: row.platforms,
    status: row.status,
    createdAt: row.created_at
  };
}

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, title, role_title, seniority_level, employment_type, headcount,
               location, target_recommend_count, daily_recommend_cap, platforms,
               status, created_at
        FROM talent_search_projects
        ORDER BY created_at DESC`;
      return res.status(200).json({ projects: rows.map(project_summary_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '검색 프로젝트 목록을 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const validationError = validateTalentSearchProjectInput(body);
    if (validationError) return res.status(400).json({ error: validationError });

    const keywords = {
      include: body.keywords?.include || [],
      or: body.keywords?.or || [],
      exact: body.keywords?.exact || [],
      exclude: body.keywords?.exclude || [],
      preferred: body.keywords?.preferred || []
    };

    try {
      const [row] = await sql`
        INSERT INTO talent_search_projects (
          title, role_title, seniority_level, experience_min_years, experience_max_years,
          employment_type, headcount, location, work_conditions, natural_language_brief,
          keywords, clarification_notes, target_recommend_count, platforms, created_by
        ) VALUES (
          ${body.title.trim()}, ${body.roleTitle.trim()}, ${body.seniorityLevel || null},
          ${body.experienceMinYears ?? null}, ${body.experienceMaxYears ?? null},
          ${body.employmentType.trim()}, ${body.headcount}, ${body.location || null},
          ${JSON.stringify(body.workConditions || {})}::jsonb, ${body.naturalLanguageBrief || null},
          ${JSON.stringify(keywords)}::jsonb, ${JSON.stringify(body.clarificationNotes || [])}::jsonb,
          ${body.targetRecommendCount}, ${JSON.stringify(body.platforms)}::jsonb, ${account.id}
        ) RETURNING id`;
      return res.status(201).json({ id: row.id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '검색 프로젝트를 만들지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
