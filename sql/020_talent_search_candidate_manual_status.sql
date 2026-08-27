-- sql/020_talent_search_candidate_manual_status.sql
--
-- 2026-08-26: 인재검색 Phase 1E-2. "정보 부족"/"중복"은 사람이 후보를
-- 열어봐야 판단 가능한 상태라 자동 채점 엔진(1B-4c)이 못 낸다 -- 그래서
-- 다른 점수/판정과 달리 이 값만 예외적으로 DB에 저장한다.
ALTER TABLE talent_search_candidates
  ADD COLUMN IF NOT EXISTS manual_status text;
