/**
 * handlers/talent-search-projects/index.js
 *
 * POST { title, roleTitle, seniorityLevel?, experienceMinYears?, experienceMaxYears?,
 *        employmentType, headcount, location?, workConditions?, naturalLanguageBrief?,
 *        keywords?: {include,or,exact,exclude,preferred}, targetRecommendCount,
 *        platforms: string[], clarificationNotes?: [{question,answer}] }
 *   -> 201 { id }
 *
 * Phase 1C: 검색 프로젝트를 실제로 만드는 첫 엔드포인트. status는 항상
 * 'draft'로 시작한다 -- 검색기준 확인·승인(1D)과 검색 진행(1E)은 아직
 * 없다. 목록 조회(GET)도 이번 범위 밖이다 -- 만든 프로젝트를 대시보드
 * 카드에 연동하는 건 다음 슬라이스에서 다룬다
 * (docs/superpowers/specs/2026-08-25-talent-search-phase1c-design.md 참고).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { validateTalentSearchProjectInput } from '../_lib/talentSearchProjectValidate.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

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
