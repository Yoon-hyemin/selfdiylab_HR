/**
 * handlers/talent-search-projects/index.js
 *
 * GET  -> 200 { projects: [{ id, title, roleTitle, seniorityLevel,
 *              experienceMinYears, experienceMaxYears, employmentType, headcount,
 *              location, targetRecommendCount, dailyRecommendCap, platforms,
 *              status, policyVersionId, keywords, locationDistricts,
 *              educationLevels, createdAt }] } (최신순 전체)
 * POST { title, roleTitle, seniorityLevel?, experienceMinYears?, experienceMaxYears?,
 *        employmentType, headcount, location?, workConditions?, naturalLanguageBrief?,
 *        keywords?: {include,or,exact,exclude,preferred}, locationDistricts?: string[],
 *        educationLevels?: string[], targetRecommendCount,
 *        platforms: string[], clarificationNotes?: [{question,answer}] }
 *   -> 201 { id }
 *
 * locationDistricts/educationLevels(2026-09-02 추가)는 사람인 인재풀
 * 사이드바 필터(구/군 단위 지역, 학력 5단계)에 대응하는 값이다 --
 * keywords(자유 텍스트 3칸)와는 별개 컬럼. 둘 다 빈 배열이면 그
 * 필터를 안 건드린다는 뜻.
 *
 * Phase 1C에서 POST만 만들었고(검색 프로젝트를 실제로 만드는 첫 엔드포인트,
 * status는 항상 'draft'로 시작) 목록 조회는 없었다. Phase 1D-1에서 GET을
 * 추가한다 -- 대시보드 카드 목록용으로 가벼운 필드만 내려준다(keywords/
 * workConditions/naturalLanguageBrief/clarificationNotes 같은 무거운 필드는
 * 상세 조회, handlers/talent-search-projects/[id].js에서만 내려줌).
 *
 * Phase 1E-3에서 policyVersionId를 이 목록 응답에 추가했다 -- 대시보드가
 * "누적 추천" 숫자를 계산하려면 승인된 프로젝트가 어느 채점 기준 버전에
 * 고정됐는지를 목록 단계에서부터 알아야 하는데(승인된 프로젝트만 골라서
 * GET .../candidates를 호출해야 하므로), 원래 이 필드가 목록 응답에
 * 빠져 있어서 승인된 프로젝트를 하나도 못 찾아 "누적 추천"이 항상 0으로
 * 나오는 버그가 있었다(수동 검증 중 발견). 이미 존재하는 컬럼(sql/018)을
 * 목록에도 내려주는 것뿐이라 스키마 변경이나 새 엔드포인트는 아니다.
 *
 * 2026-09-03 버그 수정: experience_min_years/experience_max_years도
 * 같은 이유로 이 목록 응답에 빠져 있었다 -- 크롬 확장의 "목표 인원
 * 채우기"가 프로젝트 조건을 읽어올 때 이 목록 엔드포인트를 쓰는데,
 * 값 자체가 응답에 없어서 화면(1단계 조건 요약)엔 경력 범위가 보여도
 * 확장은 그 값을 아예 받을 수 없어 사람인 검색에 전혀 반영되지
 * 않았다(실사용에서 "경력 설정란은 있지만 반영이 안 된다"로 발견됨).
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess, requireTalentSearchAccessOrToken } from '../_lib/accountAuth.js';
import { validateTalentSearchProjectInput } from '../_lib/talentSearchProjectValidate.js';

function project_summary_out(row) {
  return {
    id: row.id,
    title: row.title,
    roleTitle: row.role_title,
    seniorityLevel: row.seniority_level,
    experienceMinYears: row.experience_min_years === null ? null : Number(row.experience_min_years),
    experienceMaxYears: row.experience_max_years === null ? null : Number(row.experience_max_years),
    employmentType: row.employment_type,
    headcount: row.headcount,
    location: row.location,
    targetRecommendCount: row.target_recommend_count,
    dailyRecommendCap: row.daily_recommend_cap,
    platforms: row.platforms,
    status: row.status,
    policyVersionId: row.policy_version_id,
    keywords: row.keywords,
    locationDistricts: row.location_districts,
    educationLevels: row.education_levels,
    createdAt: row.created_at
  };
}

export default async function handler(req, res) {
  // GET(목록 조회)만 크롬 확장의 연결 코드 인증도 허용한다 -- 확장
  // 팝업이 "어느 프로젝트에 넣을지" 드롭다운을 채울 때 이 엔드포인트를
  // 그대로 재사용하기 위해서다. POST(프로젝트 생성)는 HR 사이트 화면
  // 전용 기능이라 그대로 쿠키 세션만 받는다.
  const account = req.method === 'GET'
    ? await requireTalentSearchAccessOrToken(req, res)
    : await requireTalentSearchAccess(req, res);
  if (!account) return;

  if (req.method === 'GET') {
    try {
      const rows = await sql`
        SELECT id, title, role_title, seniority_level, experience_min_years, experience_max_years,
               employment_type, headcount, location, target_recommend_count, daily_recommend_cap,
               platforms, status, policy_version_id, keywords, location_districts, education_levels,
               created_at
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
          keywords, clarification_notes, target_recommend_count, platforms, created_by,
          location_districts, education_levels
        ) VALUES (
          ${body.title.trim()}, ${body.roleTitle ? body.roleTitle.trim() : null}, ${body.seniorityLevel || null},
          ${body.experienceMinYears ?? null}, ${body.experienceMaxYears ?? null},
          ${body.employmentType ? body.employmentType.trim() : null}, ${body.headcount ?? null}, ${body.location || null},
          ${JSON.stringify(body.workConditions || {})}::jsonb, ${body.naturalLanguageBrief || null},
          ${JSON.stringify(keywords)}::jsonb, ${JSON.stringify(body.clarificationNotes || [])}::jsonb,
          ${body.targetRecommendCount}, ${JSON.stringify(body.platforms)}::jsonb, ${account.id},
          ${JSON.stringify(body.locationDistricts || [])}::jsonb, ${JSON.stringify(body.educationLevels || [])}::jsonb
        ) RETURNING id`;
      return res.status(201).json({ id: row.id });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '검색 프로젝트를 만들지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
