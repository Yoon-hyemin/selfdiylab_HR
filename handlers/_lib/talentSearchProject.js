/**
 * handlers/_lib/talentSearchProject.js
 *
 * 검색 프로젝트(talent_search_projects) 행을 API 응답 모양(camelCase)으로
 * 바꾸는 공용 변환 함수. 상세 조회(handlers/talent-search-projects/[id].js)와
 * 승인 액션(handlers/talent-search-projects/[id]/approve.js)이 같은 모양의
 * 응답을 돌려줘야 해서 여기 한 곳에 모은다 -- handlers/accounts/[id].js와
 * handlers/accounts/[id]/*.js가 handlers/_lib/accountAdmin.js의 account_out을
 * 공유하는 기존 패턴과 동일하다.
 *
 * Phase 1D-2에서 policyVersionId 필드가 추가됐다(승인 전엔 null).
 */
export function project_detail_out(row) {
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
    policyVersionId: row.policy_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
