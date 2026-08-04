-- 002_seed.sql이 넣은 나머지 가짜 데모 데이터(목표/채용 공고/지원자/캘리브레이션 사이클)를 정리한다.
-- evals/oneonones는 004_real_members.sql에서 가짜 구성원을 지울 때 ON DELETE CASCADE로 이미 비워졌음.
-- holidays(공휴일)는 실제 데이터라 남겨둔다.
DELETE FROM jobs WHERE title IN ('프론트엔드 개발자 (3년 이상)', 'HR 매니저 (성과관리 담당)');
-- candidates, candidate_history는 jobs ON DELETE CASCADE로 함께 삭제됨

DELETE FROM okrs WHERE quarter = '2026-Q3'
  AND title IN ('신뢰받는 채용 브랜드로 성장한다', '채용 리드타임 30일 이내로 단축', '전 구성원 목표 등록률 100% 달성');

DELETE FROM calibration_cycles WHERE quarter = '2026-Q2';
