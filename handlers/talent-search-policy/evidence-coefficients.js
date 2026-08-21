/**
 * PATCH { evidenceCoefficients: {none,weak,partial,clear} }
 * -> 200 { ...policy_out 응답 (초안 행, status:"draft") }
 *
 * 1B-4a부터 changeReason은 이 요청에 없다 -- 저장은 초안에만 반영되고,
 * changeReason은 별도의 PATCH /talent-search-policy/draft/apply 시점에만
 * 받는다.
 *
 * 1B-3: 근거수준별 점수 수정. 저장 형식은 0~1 소수(예: 0.65) -- 화면에서는
 * %로 입력받아 저장 직전에 소수로 변환한다. none<=weak<=partial<=clear
 * 순서를 서버에서 강제한다("약한 근거"가 "명확한 근거"보다 점수가 높아지는
 * 모순을 막기 위함).
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateEvidenceCoefficients } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateEvidenceCoefficients(body.evidenceCoefficients),
  buildOverrides: (body) => ({ evidence_coefficients: body.evidenceCoefficients })
});
