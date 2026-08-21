/**
 * handlers/talent-search-policy/draft.js
 *
 * DELETE /api/talent-search-policy/draft
 * Body 없음 -> 200 { discarded: true }
 *
 * 1B-4a: 지금 있는 초안을 완전히 버린다. 초안이 없어도 에러 없이 200(멱등) --
 * 이미 없는 걸 지우려 하는 건 실패로 볼 이유가 없다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { discardDraft } from '../_lib/talentSearchPolicy.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  try {
    await discardDraft();
    return res.status(200).json({ discarded: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '초안 삭제에 실패했어요' });
  }
}
