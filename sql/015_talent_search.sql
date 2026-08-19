-- sql/015_talent_search.sql
--
-- 2026-08-19: 인재검색 자동화 기능 Phase 1A. 이 마이그레이션은 사이드바
-- 메뉴/권한 플래그와 대시보드 뼈대만 만들기 위한 최소 스키마다. 전체 목표
-- 스키마는 docs/superpowers/specs/2026-08-19-talent-search-automation-design.md
-- 참고 -- 기준 관리, 후보자, 평가 등 나머지 테이블은 Phase 1B~1E에서 별도
-- 마이그레이션으로 추가한다.
--
-- can_use_talent_search는 accounts.system_role(ADMIN/DEPARTMENT_HEAD/EMPLOYEE)과
-- 별개 축이다. ADMIN은 이 값과 무관하게 항상 접근 가능(핸들러에서 검사),
-- 그 외 역할은 이 플래그가 true일 때만 "인재검색" 메뉴가 보인다 --
-- "승인된 채용담당자"가 꼭 부서장/관리자일 필요는 없다는 요구사항 때문에
-- system_role 값을 늘리는 대신 별도 boolean으로 뺐다.
ALTER TABLE accounts ADD COLUMN can_use_talent_search boolean NOT NULL DEFAULT false;

-- 검색 프로젝트. 이번 Phase에서는 행을 만드는 화면이 없어(Phase 1C에서
-- 추가) 테이블은 비어 있는 채로 시작한다 -- 스키마를 먼저 확정해두면 이후
-- Phase에서 이 테이블에 대한 ALTER 없이 바로 API를 붙일 수 있다.
CREATE TABLE talent_search_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  role_title text NOT NULL,
  seniority_level text,
  experience_min_years numeric,
  experience_max_years numeric,
  employment_type text,
  headcount integer,
  location text,
  work_conditions jsonb NOT NULL DEFAULT '{}',
  natural_language_brief text,
  target_recommend_count integer NOT NULL,
  daily_recommend_cap integer NOT NULL DEFAULT 50,
  platforms jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
