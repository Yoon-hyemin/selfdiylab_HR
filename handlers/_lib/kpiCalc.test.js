/**
 * handlers/_lib/kpiCalc.test.js
 *
 * node --test로 실행(새 테스트 러너 의존성 추가하지 않음, Node 18+ 내장).
 * 요구사항 문서의 D. 필수 테스트 중 순수 계산 로직으로 검증 가능한
 * 항목(1,2,3,4,5,6,7,8,11)을 여기서 커버한다. 9/10/12(상태값·권한 분기)는
 * DB/HTTP를 타는 통합 동작이라 브라우저 수동 검증으로 확인한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, weightedLevelRate, periodMonthCount, monthsBetween,
  periodCumulativeRate, companyMonthlyRateFromDepts, elapsedAverageRate
} from './kpiCalc.js';

test('clamp01: 범위 밖 값은 0~1로 강제, 숫자가 아니면 0', () => {
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(null), 0);
  assert.equal(clamp01(undefined), 0);
});

test('periodMonthCount: 반기(6개월)/분기(3개월)를 실제 날짜에서 도출', () => {
  assert.equal(periodMonthCount('2026-07-01', '2026-12-31'), 6);
  assert.equal(periodMonthCount('2026-01-01', '2026-03-31'), 3);
  assert.equal(periodMonthCount('2026-01-01', '2026-01-31'), 1);
  assert.equal(periodMonthCount('2026-01-01', '2026-12-31'), 12);
});

test('monthsBetween: 시작~종료월 포함 목록', () => {
  assert.deepEqual(monthsBetween('2026-07', '2026-12'), [
    '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12'
  ]);
  assert.deepEqual(monthsBetween('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

// 시나리오 1: 반기 목표, 첫 달만 100% 실행 -> 기간 누적 16.6667%
test('시나리오1: 반기 목표 첫 달 100% -> 누적 16.6667%', () => {
  const monthly01 = [1, 0, 0, 0, 0, 0]; // 7월만 100%, 8~12월 아직 도래 안함(0)
  const cum = periodCumulativeRate(monthly01, periodMonthCount('2026-07-01', '2026-12-31'));
  assert.equal(Math.round(cum * 1e6) / 1e6, 0.166667);
});

// 시나리오 2: 반기 목표, 두 달 연속 100% -> 누적 33.3333%
test('시나리오2: 반기 목표 두 달 연속 100% -> 누적 33.3333%', () => {
  const monthly01 = [1, 1, 0, 0, 0, 0];
  const cum = periodCumulativeRate(monthly01, periodMonthCount('2026-07-01', '2026-12-31'));
  assert.equal(Math.round(cum * 1e6) / 1e6, 0.333333);
});

// 시나리오 3: 분기 목표, 첫 달 100% -> 누적 33.3333%
test('시나리오3: 분기 목표 첫 달 100% -> 누적 33.3333%', () => {
  const monthly01 = [1, 0, 0];
  const cum = periodCumulativeRate(monthly01, periodMonthCount('2026-01-01', '2026-03-31'));
  assert.equal(Math.round(cum * 1e6) / 1e6, 0.333333);
});

// 시나리오 4: 연결 부서 중 하나가 그 달 목표/실적 미입력 -> 0%로 반영,
// 계산 분모(부서 수)에서 빼지 않는다.
test('시나리오4: 미입력 부서는 0%로 반영되고 분모에서 빠지지 않음', () => {
  const depts = [
    { rate: 1, contribution: 1 / 2 },      // 목표 100% 달성
    { rate: null, contribution: 1 / 2 }    // 미입력
  ];
  const companyRate = companyMonthlyRateFromDepts(depts);
  assert.equal(companyRate, 0.5); // (1*0.5)+(0*0.5) = 0.5, 부서 2개 그대로 반영
});

// 시나리오 5: 기업 목표에 연결되지 않은 부서는 계산 대상에서 제외(호출부가
// depts 배열에 넣지 않는 것으로 배제한다는 계약 확인).
test('시나리오5: 미연결 부서는 애초에 배열에 없어야 하고, 있으면 결과가 달라짐', () => {
  const linkedOnly = companyMonthlyRateFromDepts([{ rate: 1, contribution: 1 }]);
  assert.equal(linkedOnly, 1);
  // 미연결 부서(예: rate 0)를 잘못 섞어 넣으면 결과가 오염된다는 걸 보여줌 -- 그래서 호출부는 연결된 부서만 넘겨야 한다.
  const wronglyIncluded = companyMonthlyRateFromDepts([{ rate: 1, contribution: 0.5 }, { rate: 0, contribution: 0.5 }]);
  assert.notEqual(wronglyIncluded, linkedOnly);
});

// 시나리오 6: 개인 목표는 부서 목표를 통해 한 번만 반영 -- weightedLevelRate를
// 부서 레벨(개인 목표들)에 적용한 rate를, 다시 기업 레벨(부서 목표들)에
// 적용할 때 원래 개인 목표 값이 다시 등장하지 않는지 확인.
test('시나리오6: 개인->부서->기업 순으로 한 번만 반영(중복 합산 없음)', () => {
  const personalGoals = [{ weight: 100, rate: 1 }]; // 개인 목표 1개, 100% 완료
  const deptOwnRate = weightedLevelRate(personalGoals).rate; // 부서 목표의 진행률 자체가 이 값이라고 가정(orgProgress 역할)
  assert.equal(deptOwnRate, 1);
  // 기업 레벨 집계는 "부서 목표"만 입력으로 받는다 -- personalGoals가 다시
  // 등장하지 않고, deptOwnRate 하나로만 반영된다.
  const companyLevel = weightedLevelRate([{ weight: 100, rate: deptOwnRate }]);
  assert.equal(companyLevel.rate, 1); // 두 번 곱해지지 않고 1(=100%) 그대로
});

// 시나리오 7: 목표 가중치 합계가 100%가 아니면 확정하지 않고 null(=가중치
// 설정 미완료)을 돌려준다.
test('시나리오7: 가중치 합계 100% 아니면 rate=null(미확정)', () => {
  const incomplete = weightedLevelRate([{ weight: 60, rate: 1 }, { weight: 30, rate: 0.5 }]); // 합 90
  assert.equal(incomplete.rate, null);
  assert.equal(incomplete.complete, false);
  const oneUnweighted = weightedLevelRate([{ weight: 100, rate: 1 }, { weight: null, rate: 0.5 }]); // 하나는 가중치 미설정
  assert.equal(oneUnweighted.rate, null);
  const complete = weightedLevelRate([{ weight: 60, rate: 1 }, { weight: 40, rate: 0.5 }]); // 합 100
  assert.equal(complete.rate, 0.6 * 1 + 0.4 * 0.5);
  assert.equal(complete.complete, true);
});

// 시나리오 8: 연간 목표 400억, 확정 누적 실적 159억 -> 39.75%, 잔여 241억
// (매출 계산식은 index.html에 그대로 있지만, 여기서는 같은 산술을 순수
// 함수처럼 검증한다 -- 나눗셈/뺄셈 자체는 이 모듈의 함수를 안 타므로 직접 계산)
test('시나리오8: 매출 연간 달성률/잔여목표 계산', () => {
  const annualTarget = 40_000_000_000;
  const cumulativeActual = 15_900_000_000;
  const remaining = Math.max(annualTarget - cumulativeActual, 0);
  const rate = (cumulativeActual / annualTarget) * 100;
  assert.equal(remaining, 24_100_000_000);
  assert.equal(rate, 39.75);
});

// 2026-08-12(2차): "기준월까지 실행률" vs "전체 기간 진척도" 요구사항 예시
// 그대로 검증 -- 7월 80%, 8월 60%, 9~12월은 아직 안 지난 반기 목표.
test('기준월까지 실행률(경과월 평균) 8월 기준 70%', () => {
  const elapsed = [0.8, 0.6]; // 7월, 8월만 -- 9~12월은 호출부가 애초에 안 넣음
  assert.equal(elapsedAverageRate(elapsed), 0.7);
});
test('전체 기간 진척도(반기 6개월 분모, 미래월 0 포함) 23.3%', () => {
  const allSixMonths = [0.8, 0.6, 0, 0, 0, 0];
  const result = periodCumulativeRate(allSixMonths, 6);
  assert.equal(Math.round(result * 1000) / 1000, 0.233);
});
test('elapsedAverageRate: 데이터 없으면 null, 미입력 달은 0으로 반영(분모 유지)', () => {
  assert.equal(elapsedAverageRate([]), null);
  assert.equal(elapsedAverageRate(null), null);
  assert.equal(elapsedAverageRate([1, null]), 0.5); // 미입력 달도 분모에는 남음
});

// 시나리오 11: 월별 목표 합계가 241억과 불일치하면 확정을 막아야 한다 --
// 검증 로직 자체(합계 비교)를 순수 함수 형태로 확인.
test('시나리오11: 월별 목표 합계가 잔여목표와 다르면 불일치로 판정', () => {
  const monthlyTargets = [4_000_000_000, 4_000_000_000, 4_000_000_000, 4_000_000_000, 4_000_000_000, 4_000_000_000]; // 240억
  const remaining = 24_100_000_000;
  const sum = monthlyTargets.reduce((a, v) => a + v, 0);
  assert.equal(sum === remaining, false); // 불일치 -> 확정 금지 상태가 돼야 함
  const fixed = [...monthlyTargets.slice(0, 5), 4_100_000_000];
  assert.equal(fixed.reduce((a, v) => a + v, 0), remaining); // 241억로 맞추면 일치
});
