-- 2026-08-06: 부서장이 팀원 개인 목표를 검토(승인/반려)할 수 있게 status 추가.
-- 기존 행(회사/조직/개인 전부)은 DEFAULT 'approved'로 백필돼서 소급 적용되지
-- 않는다 -- 검토 흐름은 이 마이그레이션 이후 새로 만드는 개인 목표부터
-- 적용된다(handlers/my-goals/index.js가 새 개인 목표를 'pending'으로 만듦).
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS review_note text;
