/**
 * handlers/talent-search-policy/draft/apply.js
 *
 * PATCH /api/talent-search-policy/draft/apply
 * Body: { changeReason: string } -> 200 { ...policy_out 응답(새로 활성화된 버전) }
 *
 * 1B-4a: 초안을 활성 버전으로 승격한다. changeReason은 이 시점에 딱 한 번만
 * 받는다 -- 여러 카드를 고쳐 쌓은 초안 전체에 대한 사유이기 때문에, 카드별
 * 저장 액션에서는 더 이상 받지 않는다.
 */
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';
import { getDraftPolicy, applyDraft, policy_out } from '../../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { changeReason } = req.body || {};
  if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });

  try {
    const draft = await getDraftPolicy();
    if (!draft) return res.status(404).json({ error: '적용할 초안이 없어요' });
    const updated = await applyDraft(changeReason.trim(), account.id);
    return res.status(200).json(policy_out(updated));
  } catch (err) {
    // applyDraft가 내부적으로 같은 두 조건을 다시 확인하며 던지는 에러 문구를
    // 그대로 이어받아 404로 매핑한다(위에서 이미 확인했으니 사실상 도달하지
    // 않지만, 방어적으로 의미를 보존한다) -- 그 외는 일반 500.
    if (err.message === '적용할 초안이 없어요' || err.message === '적용 중인 기준이 없어요') {
      return res.status(404).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: '초안 적용에 실패했어요' });
  }
}
