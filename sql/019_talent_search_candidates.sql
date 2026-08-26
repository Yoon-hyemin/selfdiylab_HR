-- sql/019_talent_search_candidates.sql
--
-- 2026-08-26: 인재검색 자동화 Phase 1E-1(가상 후보 생성 + 검색 진행 목록
-- 화면). 승인된 검색 프로젝트마다 서버가 생성한 가상 후보의 raw 속성만
-- 저장한다 -- 점수·판정(Level1 상태, 공통/직무 점수, 총점, 추천 여부)은
-- 컬럼으로 두지 않는다. index.html의 evaluateLevel1/scoreItemGroup/
-- simulateCandidate(1B-4c에서 만든 채점 엔진)가 화면에서 그 프로젝트가
-- 승인 시점에 고정해 둔 채점 기준으로 매번 계산한다 -- 이 프로젝트의
-- "서버는 원본만, 계산은 클라이언트" 원칙 그대로.
--
-- evidence_pattern은 1B-4c의 VIRTUAL_CANDIDATES와 정확히 같은 모양
-- (['명확','부분','약함','명확','없음'] 같은 5개 길이 배열)이라, 채점
-- 시 index.html의 기존 함수를 수정 없이 그대로 쓸 수 있다.
CREATE TABLE IF NOT EXISTS talent_search_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL,
  resume_age_days integer NOT NULL,
  short_tenure_count integer NOT NULL,
  gap_months integer NOT NULL,
  evidence_pattern jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
