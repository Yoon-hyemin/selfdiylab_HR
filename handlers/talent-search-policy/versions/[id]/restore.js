// handlers/talent-search-policy/versions/[id]/restore.js
/**
 * handlers/talent-search-policy/versions/[id]/restore.js
 *
 * PATCH /api/talent-search-policy/versions/:id/restore
 * Body 없음 -> 200 { ...policy_out 응답(새로 만들어진 초안) }
 *
 * 1B-4b: 과거(또는 활성) 버전 하나를 골라 그 값 그대로 초안으로 복구한다.
 * 이미 초안이 있었다면 통째로 덮어쓴다(1B-4a의 카드별 저장처럼 이어서
 * 병합하는 게 아니라, "이 시점 스냅샷으로 완전히 교체"가 목적이라서다 --
 * 사용자가 명시적으로 확인한 동작).
 */
import { requireTalentSearchAccess } from '../../../_lib/accountAuth.js';
import { restoreVersionAsDraft, policy_out } from '../../../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  try {
    const restored = await restoreVersionAsDraft(id, account.id);
    return res.status(200).json(policy_out(restored));
  } catch (err) {
    if (err.message === '복구할 버전을 찾을 수 없어요') return res.status(404).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: '버전 복구에 실패했어요' });
  }
}
