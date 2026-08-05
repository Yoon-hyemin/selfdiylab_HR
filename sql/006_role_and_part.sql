ALTER TABLE members ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT '팀원';
-- '관리자' | '부서장' | '팀원' 세 값만 앱 레벨에서 사용 (기존 컨벤션대로 DB CHECK 제약은 걸지 않음)

ALTER TABLE okrs ADD COLUMN IF NOT EXISTS part text DEFAULT '';
-- 레벨='조직'일 때만 사용. 빈 문자열 = 파트 구분 없는 팀
