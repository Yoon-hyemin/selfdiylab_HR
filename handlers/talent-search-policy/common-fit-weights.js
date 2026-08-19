/**
 * handlers/talent-search-policy/common-fit-weights.js
 *
 * PATCH { commonFitWeights: [...], changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 1B-2: 공통 적합도 40점 배점 수정. 항목은 최소 1개, 개수 제한 없음(자유롭게
 * 추가/삭제 가능 -- 사용자 확인된 요구사항), 각 항목 key는 배열 안에서
 * 중복되면 안 되고, 합계는 정확히 40이어야 한다. key는 항목의 "정체성"이라
 * 라벨을 바꿔도 유지된다(새 항목의 key는 프론트에서 생성).
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, createPolicyVersion, policy_out } from '../_lib/talentSearchPolicy.js';

export function validateCommonFitWeights(items) {
  if (!Array.isArray(items) || items.length === 0) return '항목이 1개 이상 있어야 해요';
  const seenKeys = new Set();
  let sum = 0;
  for (const item of items) {
    if (!item || typeof item.key !== 'string' || !item.key.trim()) return '항목 key가 올바르지 않아요';
    if (seenKeys.has(item.key)) return '항목 key가 중복돼요';
    seenKeys.add(item.key);
    if (typeof item.label !== 'string' || !item.label.trim()) return '항목 이름을 입력해주세요';
    if (typeof item.points !== 'number' || !Number.isFinite(item.points) || item.points < 0) return '배점은 0 이상의 숫자여야 해요';
    sum += item.points;
  }
  if (sum !== 40) return `배점 합계가 40점이어야 해요 (지금 합계: ${sum}점)`;
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { commonFitWeights, changeReason } = req.body || {};
  if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });
  const validationError = validateCommonFitWeights(commonFitWeights);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const current = await getActivePolicy();
    if (!current) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    const updated = await createPolicyVersion(current, { common_fit_weights: commonFitWeights }, account.id, changeReason.trim());
    return res.status(200).json(policy_out(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준 수정에 실패했어요' });
  }
}
