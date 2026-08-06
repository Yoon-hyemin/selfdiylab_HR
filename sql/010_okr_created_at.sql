-- 2026-08-06: 부서 목표 페이지의 "승인 대기 목표" 목록에 제출일을 보여주기
-- 위해 okrs에 created_at을 추가한다(지금까지는 없었다). 기존 행은
-- DEFAULT now()로 백필되므로 실제 생성 시각과는 다르지만, 이 마이그레이션
-- 이후 새로 만드는 행부터는 정확한 값을 갖는다.
ALTER TABLE okrs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
