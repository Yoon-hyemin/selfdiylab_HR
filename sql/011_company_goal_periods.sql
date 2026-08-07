-- 2026-08-07: 기업 목표를 "매달 새로 만드는 것"에서 "기간형 목표 + 월별
-- 진행기록"으로 확장한다. 기존 월별 기업 목표(quarter/month만 있고
-- period_type/start_date/end_date가 NULL인 행)는 그대로 둔다 -- 조회 쪽
-- 코드가 NULL이면 기존 month 컬럼에서 기간을 파생시켜서 하위 호환한다
-- (handlers/_lib/goalPeriod.js의 deriveGoalPeriod 참고).
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS period_type text;
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS end_date date;

-- 기업 목표 본체(okrs)와 분리된 월별 진행기록. 같은 목표의 같은 연·월에는
-- 하나만 존재해야 해서 (okr_id, year, month) unique 제약을 둔다. 누적
-- 값(cumulative)은 별도로 저장하지 않는다 -- 이 프로젝트는 "서버는 원본만,
-- 집계는 클라이언트가 매번 계산"하는 방식을 이미 쓰고 있어서(CLAUDE.md), 월별
-- 실적을 기간 시작부터 선택 월까지 합산해서 누적치를 매번 계산한다.
CREATE TABLE IF NOT EXISTS okr_monthly_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  okr_id uuid NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
  year integer NOT NULL,
  month integer NOT NULL,
  monthly_target_value numeric,
  monthly_actual_value numeric,
  status text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(okr_id, year, month)
);
