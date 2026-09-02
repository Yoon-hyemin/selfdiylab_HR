-- sql/023_talent_search_location_education.sql
--
-- 2026-09-02: 검색 실행 자동화에 지역(구 단위)·학력 조건을 추가한다.
-- 둘 다 사람인 인재풀 화면의 사이드바 필터(자유 텍스트 키워드 3칸과는
-- 별개)에 대응하는 값이라 keywords와 나란히 새 컬럼으로 둔다.
-- location_districts: "영등포구", "양천구"처럼 구/군 단위 이름의
-- 배열(시/도 접두어 없음 -- 사람인 화면에서 구/군 이름만으로 매칭).
-- education_levels: 사람인 학력 필터의 5개 고정값(고등학교/대학(2,3년)/
-- 대학(4년)/석사/박사) 중 고른 값의 배열. 둘 다 기본값 빈 배열 --
-- 조건 없음(필터 안 건드림)을 뜻한다. 기존 행은 전부 빈 배열로 채워진다.
ALTER TABLE talent_search_projects
  ADD COLUMN location_districts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN education_levels jsonb NOT NULL DEFAULT '[]'::jsonb;
