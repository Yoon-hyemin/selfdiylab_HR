-- 2026-08-12: 기업(회사) 목표별로 연결된 부서의 "부서 기여도"를 관리자가
-- 직접 설정할 수 있게 한다. 기존에는 연결된 부서 수로 무조건 균등 배분했다.
-- 이 테이블에 행이 없는 회사 목표는 여전히 (연결된 부서 수 기준) 균등
-- 배분으로 계산한다(index.html의 companyDeptContributions 참고) -- 그래서
-- 기존 데이터에 대한 별도 백필이 필요 없다. 관리자가 한 번이라도 저장하면
-- 그 값이 이 테이블에 남고, 그 이후로는 균등 배분 대신 이 값을 쓴다.
CREATE TABLE IF NOT EXISTS company_goal_dept_contributions (
  company_okr_id uuid NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
  team text NOT NULL,
  contribution integer NOT NULL CHECK (contribution >= 0 AND contribution <= 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_okr_id, team)
);
