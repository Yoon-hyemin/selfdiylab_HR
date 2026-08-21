/**
 * handlers/talent-search-policy/index.js
 *
 * GET -> 200 { versionNo, level1Rules, ..., status, changeReason, appliedAt,
 *              createdAt, draft: null | {...같은 모양, status:'draft'} }
 *
 * 지금 적용 중인(status='active') 정책과, 있다면 초안(status='draft')을
 * 같이 반환한다. 활성 버전 필드는 최상위에 그대로 유지해서(1B-4a 이전
 * 프론트 호출부와 하위호환), draft는 추가 필드로만 얹는다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, getDraftPolicy, policy_out } from '../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    const policy = await getActivePolicy();
    if (!policy) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    const draft = await getDraftPolicy();
    return res.status(200).json({ ...policy_out(policy), draft: draft ? policy_out(draft) : null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준을 불러오지 못했어요' });
  }
}
