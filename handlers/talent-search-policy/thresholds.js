/**
 * PATCH { thresholds: {...}, dailyRecommendCapDefault, dailyRecommendCapAbsoluteMax }
 * -> 200 { ...policy_out 응답 (초안 행, status:"draft") }
 *
 * 1B-4a부터 changeReason은 이 요청에 없다 -- 저장은 초안에만 반영되고,
 * changeReason은 별도의 PATCH /talent-search-policy/draft/apply 시점에만
 * 받는다.
 *
 * 1B-3: 추천 임계값과 하루 추천상한(기본값+절대상한)을 하나의 엔드포인트로
 * 같이 수정한다 -- 화면에서도 "추천 임계값 · 하루 추천 상한" 한 카드로
 * 같이 표시되고 있어서다. 기본값은 절대상한을 넘을 수 없다.
 */
import { makePolicyPatchHandler } from '../_lib/talentSearchPolicy.js';
import { validateThresholdsAndCaps } from '../_lib/talentSearchPolicyValidate.js';

// 이 핸들러 하나가 세 개의 override 키(thresholds, daily_recommend_cap_default,
// daily_recommend_cap_absolute_max)를 동시에 매핑하는 유일한 경우라 다른 4개
// 핸들러보다 오타 위험이 커서, named export로 따로 빼 단위테스트로 직접
// 확인한다(thresholds.test.js) -- db.js를 거치지 않고도 이 매핑만 검증 가능.
export function buildOverrides(body) {
  return {
    thresholds: body.thresholds,
    daily_recommend_cap_default: body.dailyRecommendCapDefault,
    daily_recommend_cap_absolute_max: body.dailyRecommendCapAbsoluteMax
  };
}

export default makePolicyPatchHandler({
  validate: (body) => validateThresholdsAndCaps(body),
  buildOverrides
});
