-- sql/021_talent_search_list_import.sql
--
-- 2026-08-27: 인재검색 "실제 후보 리스트 가져오기" 슬라이스.
--
-- talent_search_extension_tokens: 크롬 확장이 HR 사이트 API를 호출할 때
-- 쓰는 인증 코드. 계정 비밀번호와 같은 원칙 -- 원문은 저장하지 않고
-- 해시만 저장한다. 계정당 최대 1개(재발급하면 기존 걸 대체).
CREATE TABLE IF NOT EXISTS talent_search_extension_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

-- talent_search_list_candidates: 사람인 검색결과 리스트에서 가져온 실제
-- 후보. 기존 talent_search_candidates(가상 후보, 이력서 전체를 읽었다는
-- 전제의 raw 필드로 구성)와는 완전히 별개 테이블이다 -- 이번 슬라이스는
-- 채점을 하지 않으므로 그 테이블의 필드(resume_age_days 등)가 필요
-- 없고, 대신 리스트 화면에 실제로 보이는 필드만 그대로 저장한다.
CREATE TABLE IF NOT EXISTS talent_search_list_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id) ON DELETE CASCADE,
  platform text NOT NULL,
  masked_name text NOT NULL,
  gender text,
  age integer,
  career_summary text,
  recent_positions jsonb NOT NULL DEFAULT '[]',
  education text,
  tags jsonb NOT NULL DEFAULT '[]',
  badges jsonb NOT NULL DEFAULT '[]',
  last_updated_label text,
  source_url text NOT NULL,
  imported_by_account_id uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
