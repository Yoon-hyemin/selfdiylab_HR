// handlers/talent-search-policy/versions/index.js
/**
 * handlers/talent-search-policy/versions/index.js
 *
 * GET -> 200 { versions: [{ id, versionNo, status, appliedAt, changeReason,
 *              createdAt, createdByName, level1Rules, commonFitWeights,
 *              evidenceCoefficients, jobFitDefaultWeights, roundingRule,
 *              thresholds, sortTiebreakRules, dailyRecommendCapDefault,
 *              dailyRecommendCapAbsoluteMax, dataRetentionMonths }, ...] }
 *
 * 1B-4b: 최근 50개 버전(초안 제외) 이력을 최신순으로 반환한다. 각 행에
 * 정책 필드 전체를 포함하는 이유는 "복구" 버튼을 눌렀을 때 화면이 그 값을
 * 다시 조회하지 않고도 쓸 수 있게 하기 위해서다(행 수·필드 크기 모두 작아
 * 응답 크기 문제는 없다).
 */
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { listPolicyVersions, policy_out } from '../../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const rows = await listPolicyVersions(50);
    return res.status(200).json({
      versions: rows.map(r => ({ ...policy_out(r), createdByName: r.created_by_name || '(알 수 없음)' }))
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '버전 이력을 불러오지 못했어요' });
  }
}
