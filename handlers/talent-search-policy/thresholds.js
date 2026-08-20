/**
 * PATCH { thresholds: {...}, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax,
 *         changeReason: string } -> 200 { ...policy_out 응답 }
 *
 * 1B-3: 추천 임계값과 하루 추천상한(기본값+절대상한)을 하나의 엔드포인트로
 * 같이 수정한다 -- 화면에서도 "추천 임계값 · 하루 추천 상한" 한 카드로
 * 같이 표시되고 있어서다. 기본값은 절대상한을 넘을 수 없다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateThresholdsAndCaps } from '../_lib/talentSearchPolicyValidate.js';

export default makePolicyPatchHandler({
  validate: (body) => validateThresholdsAndCaps(body),
  buildOverrides: (body) => ({
    thresholds: body.thresholds,
    daily_recommend_cap_default: body.dailyRecommendCapDefault,
    daily_recommend_cap_absolute_max: body.dailyRecommendCapAbsoluteMax
  })
});
