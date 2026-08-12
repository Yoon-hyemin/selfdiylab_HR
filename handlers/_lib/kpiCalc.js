/**
 * handlers/_lib/kpiCalc.js
 *
 * 2026-08-12: KPI 실행률 계산 개편. 기존 버그 -- companyProgress()(index.html)가
 * 기업 목표에 연결된 부서 목표를 "존재하는 것만" 평균 내서, 반기/분기 목표가
 * 시작 후 1~2개월만 지나도 이미 100%인 것처럼 보이는 문제가 있었다(기간
 * 전체 개월 수로 나누지 않고, 아직 목표/실적을 안 넣은 미래 달을 그냥
 * 빼버렸기 때문). 이 모듈은 그 계산을 순수 함수로 분리해서 단위테스트가
 * 가능하게 하고, index.html에는 그대로 복제해서 쓴다(이 프로젝트가 이미
 * goalPeriod.js/monthWindow.js를 index.html에 복제하는 것과 같은 관례 --
 * index.html은 import 불가능한 순수 <script> 태그라서).
 *
 * 모든 rate는 내부적으로 0~1 스케일로 다룬다. 화면 표시(백분율 변환)는
 * 호출부 책임이다.
 */

// 0~1 사이로 강제. 숫자가 아니거나 null/undefined면 0.
export function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 1);
}

/**
 * 같은 레벨(부서의 부서 목표들, 또는 기업의 기업 목표들) 안에서 가중치 합
 * 100%를 기준으로 한 가중 평균. goals: [{ weight: number|null, rate: 0~1 }]
 *
 * "가중치 합계가 100%가 아니면 실행률을 확정하지 않는다"는 요구사항을
 * 그대로 반영한다 -- 목표가 하나도 없거나, 하나라도 weight가 null이거나,
 * weight 합이 정확히 100이 아니면 rate는 null(미확정)이다. partialRate는
 * 그래도 참고용으로 같이 돌려준다(예: 상위 레벨 집계에서 "미완료도 0으로
 * 취급하고 배제하지 않는다"는 별도 요구사항에 쓰인다 -- weightedLevelRate
 * 자신은 그 판단을 하지 않고 값만 제공한다).
 */
export function weightedLevelRate(goals) {
  if (!goals || !goals.length) return { rate: null, partialRate: 0, complete: false, weightSum: 0 };
  const weighted = goals.filter(g => g.weight !== null && g.weight !== undefined);
  const weightSum = weighted.reduce((a, g) => a + g.weight, 0);
  const complete = weighted.length === goals.length && weightSum === 100;
  const partialRate = weighted.reduce((a, g) => a + (g.weight / 100) * clamp01(g.rate), 0);
  return { rate: complete ? partialRate : null, partialRate, complete, weightSum };
}

// 'YYYY-MM-DD' ~ 'YYYY-MM-DD' 사이의 달 수(포함, 1 이상). 반기=6/분기=3을
// 하드코딩하지 않고 실제 시작·종료일에서 도출한다 -- 그래야 월간/연간/직접
// 설정 기간에도 같은 함수가 그대로 맞는다.
export function periodMonthCount(startDate, endDate) {
  const [sy, sm] = startDate.slice(0, 7).split('-').map(Number);
  const [ey, em] = endDate.slice(0, 7).split('-').map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

// startMonth('YYYY-MM')부터 endMonth까지(포함) 월키 배열.
export function monthsBetween(startMonth, endMonth) {
  const out = [];
  let [y, m] = startMonth.split('-').map(Number);
  const [ey, em] = endMonth.split('-').map(Number);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
    guard++;
  }
  return out;
}

/**
 * 기간에 포함된 각 달의 실행률(0~1, 아직 도래하지 않은 달은 호출부가 0으로
 * 채워서 넘긴다)을 합산해 기간 전체 개월 수로 나눈다 -- 부서 기간 누적
 * 실행률(4-2)과 기업 기간 누적 실행률(4-4)이 같은 공식이라 하나로 공용화.
 */
export function periodCumulativeRate(monthlyRates01, monthCount) {
  if (!monthCount || monthCount <= 0) return 0;
  const sum = monthlyRates01.reduce((a, r) => a + clamp01(r || 0), 0);
  return sum / monthCount;
}

/**
 * 기업 목표에 연결된 부서들의 그 달 실행률을 부서 기여도로 가중합산한다
 * (4-3). depts: [{ rate: 0~1|null, contribution: 0~1 }] -- 이미 "이 기업
 * 목표에 연결된 부서"만 걸러서 넘겨야 한다(미연결 부서는 이 배열에 넣지
 * 않는 것으로 배제한다). rate가 null(그 달 목표/실적 미입력)이면 0으로
 * 취급하되 배열에서 빼지 않는다 -- "미입력 부서는 0%, 계산 분모에서 제외
 * 안 함"이라는 요구사항 그대로.
 */
export function companyMonthlyRateFromDepts(depts) {
  if (!depts || !depts.length) return 0;
  return depts.reduce((a, d) => a + d.contribution * clamp01(d.rate == null ? 0 : d.rate), 0);
}

/**
 * 2026-08-12(2차): "기준월까지 실행률" -- 목표 시작월부터 기준월까지(미래월은
 * 애초에 배열에 넣지 않고 호출부가 잘라서 넘겨야 한다)의 월별 실행률
 * 평균이다. periodCumulativeRate(전체 기간 진척도, 분모=기간 전체 개월수,
 * 미래월=0으로 포함)와는 분모가 다르다 -- 이 함수는 "지금까지 경과한 달
 * 수"로만 나눈다. 과거/현재 달인데 데이터가 없으면(미입력) 그 달은
 * 0으로 반영하고 개월 수 자체에서는 빼지 않는다(요구사항: "분모에서
 * 제외하지 않는다").
 */
export function elapsedAverageRate(elapsedRates01) {
  if (!elapsedRates01 || !elapsedRates01.length) return null;
  const sum = elapsedRates01.reduce((a, r) => a + clamp01(r == null ? 0 : r), 0);
  return sum / elapsedRates01.length;
}
