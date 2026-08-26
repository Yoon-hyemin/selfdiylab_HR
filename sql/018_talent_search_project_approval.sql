-- sql/018_talent_search_project_approval.sql
--
-- 2026-08-26: 인재검색 자동화 Phase 1D-2(플랫폼별 검색어 생성 + 승인 액션).
-- "이 조건으로 검색" 버튼을 누르면(승인) 그 시점의 활성 채점 기준 버전
-- id를 이 컬럼에 저장해서 영구히 고정한다 -- 이후 기준 관리센터에서
-- 정책이 새 버전으로 바뀌어도 이미 승인된 프로젝트는 승인 당시 버전을
-- 계속 가리킨다. 승인 전에는 NULL.
ALTER TABLE talent_search_projects
  ADD COLUMN IF NOT EXISTS policy_version_id uuid REFERENCES talent_search_policy_versions(id);
