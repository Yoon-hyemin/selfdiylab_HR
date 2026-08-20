/**
 * handlers/talent-search-policy/common-fit-weights.js
 *
 * PATCH { commonFitWeights: [...], changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 검증 로직은 handlers/_lib/talentSearchPolicyValidate.js에 있다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateCommonFitWeights } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateCommonFitWeights(body.commonFitWeights),
  buildOverrides: (body) => ({ common_fit_weights: body.commonFitWeights })
});
