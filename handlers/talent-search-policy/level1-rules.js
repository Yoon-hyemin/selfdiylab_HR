/**
 * handlers/talent-search-policy/level1-rules.js
 *
 * PATCH { level1Rules: {...}, changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 1B-2: Level1 문턱값 수정. "수정 = 새 버전 즉시 생성+적용"이라 초안 개념은
 * 없다(1B-4에서 추가 예정). 필드 간 대소관계(예: 확인필요 일수가 통과일수
 * 보다 커야 함) 같은 세밀한 검증은 이번 범위 밖(스펙 참고) -- 최소 타입
 * 검증만 한다.
 */
import { requireTalentSearchAccess } from '../_lib/accountAuth.js';
import { getActivePolicy, createPolicyVersion, policy_out } from '../_lib/talentSearchPolicy.js';

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

export function validateLevel1Rules(l1) {
  if (!l1 || typeof l1 !== 'object') return '값이 올바르지 않아요';
  const ru = l1.resumeUpdated, st = l1.shortTenure, cg = l1.careerGap;
  if (!ru || !isPositiveInt(ru.passWithinDays) || !isPositiveInt(ru.verifyWithinDays)) return '이력서 업데이트 기준이 올바르지 않아요';
  if (!st || !isPositiveInt(st.monthsThreshold) || !isPositiveInt(st.lookbackYears) || !isPositiveInt(st.countThreshold)) return '단기근속 기준이 올바르지 않아요';
  if (!Array.isArray(st.exceptions) || st.exceptions.length === 0 || st.exceptions.some(e => typeof e !== 'string' || !e.trim())) return '단기근속 예외사유가 올바르지 않아요';
  if (!cg || !isPositiveInt(cg.ignoreUnderMonths) || !isPositiveInt(cg.verifyUnderMonths)) return '경력 공백 기준이 올바르지 않아요';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });

  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { level1Rules, changeReason } = req.body || {};
  if (!changeReason || !String(changeReason).trim()) return res.status(400).json({ error: '변경 사유를 입력해주세요' });
  const validationError = validateLevel1Rules(level1Rules);
  if (validationError) return res.status(400).json({ error: validationError });

  try {
    const current = await getActivePolicy();
    if (!current) return res.status(404).json({ error: '적용 중인 기준이 없어요' });
    const updated = await createPolicyVersion(current, { level1_rules: level1Rules }, account.id, changeReason.trim());
    return res.status(200).json(policy_out(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '기준 수정에 실패했어요' });
  }
}
