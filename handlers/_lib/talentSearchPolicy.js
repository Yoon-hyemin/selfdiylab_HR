/**
 * handlers/_lib/talentSearchPolicy.js
 *
 * 인재검색 채점 정책(talent_search_policy_versions) 공용 헬퍼. GET 핸들러와
 * 여러 PATCH 핸들러(Level1/공통40점, 이후 1B-3에서 직무60점/임계값도 추가될
 * 예정)가 전부 "현재 활성 버전 읽기"와 "필드 일부만 바꿔 새 버전 만들기"를
 * 반복하므로 여기 한 곳에 모은다.
 *
 * 수정 = 새 버전을 만들어 바로 적용(초안 단계 없음, 1B-4에서 추가 예정)하는
 * 방식이라, createPolicyVersion은 "기존 활성 버전을 supersede하고 새 활성
 * 버전을 insert"하는 트랜잭션 하나로 끝난다.
 */
import { sql } from './db.js';

export function policy_out(row) {
  return {
    versionNo: row.version_no,
    level1Rules: row.level1_rules,
    commonFitWeights: row.common_fit_weights,
    evidenceCoefficients: row.evidence_coefficients,
    jobFitDefaultWeights: row.job_fit_default_weights,
    roundingRule: row.rounding_rule,
    thresholds: row.thresholds,
    sortTiebreakRules: row.sort_tiebreak_rules,
    dailyRecommendCapDefault: row.daily_recommend_cap_default,
    dailyRecommendCapAbsoluteMax: row.daily_recommend_cap_absolute_max,
    dataRetentionMonths: row.data_retention_months,
    status: row.status,
    changeReason: row.change_reason,
    appliedAt: row.applied_at,
    createdAt: row.created_at
  };
}

export async function getActivePolicy() {
  const [row] = await sql`
    SELECT * FROM talent_search_policy_versions WHERE status = 'active'
    ORDER BY version_no DESC LIMIT 1`;
  return row || null;
}

// current: getActivePolicy()가 반환한 현재 활성 버전 row(snake_case 그대로).
// overrides: 바뀌는 필드만 snake_case 키로 담은 객체(예: { level1_rules: {...} }).
// 나머지 필드는 current 값을 그대로 복사해서 새 버전에 들어간다.
export async function createPolicyVersion(current, overrides, actorAccountId, changeReason) {
  const next = { ...current, ...overrides };
  const nextVersionNo = current.version_no + 1;
  const result = await sql.transaction([
    sql`UPDATE talent_search_policy_versions SET status = 'superseded' WHERE id = ${current.id}`,
    sql`INSERT INTO talent_search_policy_versions (
      version_no, level1_rules, common_fit_weights, evidence_coefficients,
      job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
      daily_recommend_cap_default, daily_recommend_cap_absolute_max,
      data_retention_months, status, change_reason, created_by, applied_at
    ) VALUES (
      ${nextVersionNo}, ${JSON.stringify(next.level1_rules)}::jsonb,
      ${JSON.stringify(next.common_fit_weights)}::jsonb, ${JSON.stringify(next.evidence_coefficients)}::jsonb,
      ${JSON.stringify(next.job_fit_default_weights)}::jsonb, ${JSON.stringify(next.rounding_rule)}::jsonb,
      ${JSON.stringify(next.thresholds)}::jsonb, ${JSON.stringify(next.sort_tiebreak_rules)}::jsonb,
      ${next.daily_recommend_cap_default}, ${next.daily_recommend_cap_absolute_max},
      ${next.data_retention_months}, 'active', ${changeReason}, ${actorAccountId}, now()
    ) RETURNING *`
  ]);
  return result[1][0];
}
