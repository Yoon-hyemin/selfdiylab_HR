-- members.role(단일 값) -> members.roles(배열)로 변경.
-- 실사용 중 "관리자이면서 동시에 자기 팀의 부서장"인 경우(예: 인사팀장)가
-- 있다는 게 확인돼서, 한 사람이 관리자/부서장을 동시에 가질 수 있게 바꾼다.
-- '팀원'은 독립적인 권한이 없는 기본 상태라 배열에 명시적으로 넣지 않아도
-- 되지만(빈 배열 = 팀원), 기존 데이터를 그대로 옮겨서 표시는 유지한다.
ALTER TABLE members ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT ARRAY['팀원']::text[];
UPDATE members SET roles = ARRAY[role]::text[] WHERE role IS NOT NULL;
ALTER TABLE members DROP COLUMN IF EXISTS role;
