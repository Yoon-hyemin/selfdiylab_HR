/**
 * handlers/talent-search-policy/index.js
 *
 * GET -> 200 { versionNo, level1Rules, commonFitWeights, evidenceCoefficients,
 *              jobFitDefaultWeights, roundingRule, thresholds, sortTiebreakRules,
 *              dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax,
 *              dataRetentionMonths, status, changeReason, appliedAt, createdAt }
 *
 * 지금 적용 중인(status='active') 인재검색 채점 정책 하나를 반환한다.
 * 이번 단계(1B-1)는 조회만 -- 수정(POST/PATCH)은 1B-2/1B-3에서 추가한다.
 * 회사 전체 공용 설정이라 프로젝트별로 나뉘지 않는다.
 */
import { sql } from '../_lib/db.js';
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';

function policy_out(row) {
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

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const [policy] = await sql`
      SELECT * FROM talent_search_policy_versions WHERE status = 'active'
      ORDER BY version_no DESC LIMIT 1`;
    if (!policy) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    return res.status(200).json(policy_out(policy));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준을 불러오지 못했어요' });
  }
}
