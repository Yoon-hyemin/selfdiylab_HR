-- 2026-08-12: KPI(목표관리)와 완전히 분리된 "매출 달성" 탭을 위한 테이블.
-- KPI(okrs)와 절대 합산하지 않는다는 요구사항 때문에 okrs를 재사용하지 않고
-- 별도 테이블로 둔다.
--
-- revenue_targets: 연도별 "연간 매출 목표" + "기초 확정 누적 실적"(예: 2026년은
-- 6월 30일까지의 확정 실적을 여기 한 번에 넣어두고, 7월부터는 revenue_monthly의
-- 확정된 월 매출만 추가로 누적한다 -- 기초 실적과 월별 실적이 중복 합산되지
-- 않게 하기 위한 분리).
CREATE TABLE IF NOT EXISTS revenue_targets (
  year integer PRIMARY KEY,
  annual_target numeric NOT NULL,
  base_cumulative_actual numeric NOT NULL DEFAULT 0,
  base_through_month integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- revenue_monthly: base_through_month 이후 달의 목표/실적. status가 '확정'인
-- 달만 상단 누적 실적·연간 달성률에 포함된다('입력중'은 행에서만 보임).
CREATE TABLE IF NOT EXISTS revenue_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL,
  month integer NOT NULL,
  monthly_target numeric,
  monthly_actual numeric,
  status text NOT NULL DEFAULT '입력중',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, month)
);

-- 2026년 기본값 -- 이미 2026년 행이 있으면 절대 덮어쓰지 않는다(ON CONFLICT DO
-- NOTHING). 15,900,000,000원은 "2026년 6월 30일까지"의 기초 확정 누적 실적으로,
-- 7월 이후 매출과는 revenue_monthly 테이블에서 완전히 분리되어 있어 중복
-- 합산되지 않는다.
INSERT INTO revenue_targets (year, annual_target, base_cumulative_actual, base_through_month)
VALUES (2026, 40000000000, 15900000000, 6)
ON CONFLICT (year) DO NOTHING;
