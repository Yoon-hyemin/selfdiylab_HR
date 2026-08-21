/**
 * handlers/talent-search-policy/common-fit-weights.js
 *
 * PATCH { commonFitWeights: [...] } -> 200 { ...policy_out 응답 (초안 행, status:"draft") }
 *
 * 1B-4a부터 changeReason은 이 요청에 없다 -- 저장은 초안에만 반영되고,
 * changeReason은 별도의 PATCH /talent-search-policy/draft/apply 시점에만
 * 받는다. 검증 로직은 handlers/_lib/talentSearchPolicyValidate.js에 있다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateCommonFitWeights } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateCommonFitWeights(body.commonFitWeights),
  buildOverrides: (body) => ({ common_fit_weights: body.commonFitWeights })
});
