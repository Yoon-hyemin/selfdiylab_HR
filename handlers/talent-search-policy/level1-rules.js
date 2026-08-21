/**
 * handlers/talent-search-policy/level1-rules.js
 *
 * PATCH { level1Rules: {...} } -> 200 { ...policy_out 응답 (초안 행, status:"draft") }
 *
 * 1B-4a부터 changeReason은 이 요청에 없다 -- 저장은 초안에만 반영되고,
 * changeReason은 별도의 PATCH /talent-search-policy/draft/apply 시점에만
 * 받는다. 검증 로직은 handlers/_lib/talentSearchPolicyValidate.js에 있다(1B-3에서
 * DB 비의존 파일로 이전 -- 그 전까지는 이 파일 안에 있어서 DATABASE_URL
 * 없이는 단위테스트도 못 돌렸다).
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateLevel1Rules } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateLevel1Rules(body.level1Rules),
  buildOverrides: (body) => ({ level1_rules: body.level1Rules })
});
