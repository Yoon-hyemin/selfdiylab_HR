/**
 * handlers/talent-search-policy/index.js
 *
 * GET -> 200 { versionNo, level1Rules, commonFitWeights, evidenceCoefficients,
 *              jobFitDefaultWeights, roundingRule, thresholds, sortTiebreakRules,
 *              dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax,
 *              dataRetentionMonths, status, changeReason, appliedAt, createdAt }
 *
 * 지금 적용 중인(status='active') 인재검색 채점 정책 하나를 반환한다.
 * 수정(PATCH)은 talent-search-policy/level1-rules.js, common-fit-weights.js
 * 등 별도 파일에 있다 -- 필드별로 독립적인 수정 흐름/검증을 갖기 때문.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, policy_out } from '../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const policy = await getActivePolicy();
    if (!policy) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    return res.status(200).json(policy_out(policy));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준을 불러오지 못했어요' });
  }
}
