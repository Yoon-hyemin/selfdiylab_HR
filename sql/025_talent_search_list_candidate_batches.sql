-- 여러 번 실행한 "가져오기"가 같은 사람을 중복 저장하지 않도록
-- (project_id, source_url)에 유니크 제약을 건다. 기존 development
-- 브랜치엔 이미 이 제약 없이 쌓인 중복이 있어서(실사용 확인 중 91개
-- 그룹 발견) 먼저 정리한다 -- 그룹마다 가장 먼저 들어온 행만 남기고
-- 나머지는 지운다(로컬 테스트 데이터라 안전. production엔 아직
-- source_url 저장 자체가 이 마이그레이션 전까지 없었으므로 이 정리
-- 대상 데이터가 없다).
DELETE FROM talent_search_list_candidates a
USING talent_search_list_candidates b
WHERE a.project_id = b.project_id
  AND a.source_url = b.source_url
  AND (a.created_at, a.ctid) > (b.created_at, b.ctid);

ALTER TABLE talent_search_list_candidates
  ADD CONSTRAINT talent_search_list_candidates_project_source_url_key
  UNIQUE (project_id, source_url);

-- "1차 조회"/"2차 조회" 구분을 위한 배치 식별자. 프로젝트에서 "목표
-- 인원 채우기"를 한 번 누른 세션 전체(여러 페이지에 걸친 POST 전부)가
-- 같은 batch_key를 공유한다(크롬 확장이 클릭 시점에 한 번 발급). 몇
-- 번째 조회인지(1차/2차...)는 저장하지 않고, 화면에서 각 배치의 가장
-- 이른 created_at 순으로 매번 다시 매긴다(이 프로젝트의 "서버는
-- 원본만, 집계·순서는 클라이언트가 계산" 원칙과 동일). 이 컬럼 도입
-- 이전 기존 행은 전부 NULL로 남고, 화면에서 하나의 "이전 조회" 묶음
-- 으로 취급한다.
ALTER TABLE talent_search_list_candidates
  ADD COLUMN batch_key text;
