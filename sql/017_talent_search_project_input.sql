-- sql/017_talent_search_project_input.sql
--
-- 2026-08-25: 인재검색 자동화 Phase 1C(새 인재검색 입력 화면). Phase 1A가
-- 만든 talent_search_projects 스키마에는 원본 명세 3.1절의 "기본 화면
-- 입력" 중 키워드 5종(포함/OR/정확일치/제외/우대)이 빠져 있었다 --
-- 이번에 보강한다. clarification_notes는 이번에 새로 추가하는 "추가질문
-- 최대 3개 시뮬레이션"(AI 없이 규칙 기반) 답변을 담는다.
--
-- work_conditions(Phase 1A에 이미 있음, jsonb)는 그대로 재사용한다 --
-- "근무지역 외 필수 근무조건"뿐 아니라 3.1절의 선택적 상세조건(입사가능
-- 시점/연봉/재택여부/필수자격/피해야 할 경력유형)까지 자유 키로 담는
-- 용도로 확장한다. 컬럼 자체는 안 바뀐다.
ALTER TABLE talent_search_projects
  ADD COLUMN IF NOT EXISTS keywords jsonb NOT NULL DEFAULT '{"include":[],"or":[],"exact":[],"exclude":[],"preferred":[]}',
  ADD COLUMN IF NOT EXISTS clarification_notes jsonb NOT NULL DEFAULT '[]';

-- 직무 템플릿. criteria는 검색 프로젝트 입력 폼의 조건 필드 전체를 그대로
-- 담는 스냅샷이다(검색 프로젝트명은 제외 -- 프로젝트마다 새로 짓는
-- 이름이라 템플릿과 무관). 템플릿을 나중에 고쳐도 과거에 이미 만든
-- 검색 프로젝트에는 영향이 없다(스냅샷이라 자연히 만족됨).
CREATE TABLE IF NOT EXISTS talent_search_job_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  criteria jsonb NOT NULL,
  created_by uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
