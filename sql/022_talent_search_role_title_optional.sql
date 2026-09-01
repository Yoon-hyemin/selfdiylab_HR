-- sql/022_talent_search_role_title_optional.sql
--
-- 2026-08-28: 인재검색 화면 재구성. "새 인재검색" 폼에서 채용
-- 직무/포지션명(role_title) 입력을 없애기로 해서(자동화에 안 쓰이고
-- 다른 화면 표시용으로만 쓰이던 필드), NOT NULL 제약을 풀어야 새
-- 프로젝트를 이 값 없이 저장할 수 있다. 기존 행의 값은 그대로 둔다.
ALTER TABLE talent_search_projects ALTER COLUMN role_title DROP NOT NULL;
