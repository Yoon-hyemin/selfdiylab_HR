/**
 * PATCH { jobFitDefaultWeights: [...] } -> 200 { ...policy_out 응답 (초안 행, status:"draft") }
 *
 * 1B-4a부터 changeReason은 이 요청에 없다 -- 저장은 초안에만 반영되고,
 * changeReason은 별도의 PATCH /talent-search-policy/draft/apply 시점에만
 * 받는다.
 *
 * 1B-3: 직무 적합도 60점 기본 배점 수정. 공통 40점과 동일한 모양(항목
 * 자유 추가/삭제, 합계 정확히 60) -- validateJobFitDefaultWeights가
 * 내부적으로 공통 40점과 같은 validatePointsList를 공유한다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateJobFitDefaultWeights } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateJobFitDefaultWeights(body.jobFitDefaultWeights),
  buildOverrides: (body) => ({ job_fit_default_weights: body.jobFitDefaultWeights })
});
