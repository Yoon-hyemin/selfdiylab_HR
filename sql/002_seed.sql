DO $$
DECLARE
  u1 uuid; u2 uuid; u3 uuid; u4 uuid; u5 uuid;
  j1 uuid; j2 uuid;
  c1 uuid; c2 uuid; c3 uuid;
  o1 uuid; o2 uuid;
BEGIN
  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, overtime_policy, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('김서연','마케팅팀','매니저','seoyeon.kim@selfdiylab.com','2024001','2024-03-04','2024-03-04','정규직','1994-05-12','010-1234-5678','서울시 성동구','무기계약직 근로계약서 (2024.03.04 체결)','연봉제 임금계약 (2026년 갱신)','매월 25일 지급 · 계좌이체','기본 근무유형',true,'주 40시간','기본 초과근무 보상정책 · 포괄 아님 · 사후 정산','입사일 기준 부여','반차 단위 사용','연차 촉진 사용','브랜드 마케팅과 캠페인 기획을 담당하고 있어요.','32시간','8.5일',2,1)
  RETURNING id INTO u1;
  INSERT INTO member_awards (member_id, title, date) VALUES (u1, '2025 상반기 우수사원', '2025-07-01');
  INSERT INTO member_career (member_id, company, role, period) VALUES (u1, '전 직장 A', '마케터', '2021~2024');
  INSERT INTO member_education (member_id, school, major, period) VALUES (u1, 'OO대학교', '경영학', '2016~2020');
  INSERT INTO member_family (member_id, name, relation) VALUES (u1, '김OO', '배우자');

  INSERT INTO members (name, nickname, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, overtime_policy, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('박준혁','준','개발팀','선임','junhyuk.park@selfdiylab.com','2023014','2023-09-18','2023-09-18','정규직','1992-11-02','010-2222-3333','경기도 성남시','무기계약직 근로계약서 (2023.09.18 체결)','연봉제 임금계약','매월 25일 지급 · 계좌이체','선택적 근로시간제',false,'주 40시간','포괄 계약 공제 주기 매달 1일-말일','회계일 기준 부여','반차 단위 사용','연차 촉진 미사용','백엔드 시스템과 사내 HR 시스템 개발을 맡고 있어요.','40시간','11일',1,0)
  RETURNING id INTO u2;
  INSERT INTO member_education (member_id, school, major, period) VALUES (u2, 'OO대학교', '컴퓨터공학', '2015~2019');

  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, overtime_policy, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('이하은','피플팀','매니저','haeun.lee@selfdiylab.com','2022007','2022-01-10','2022-01-10','정규직','1990-02-20','010-4444-5555','서울시 마포구','무기계약직 근로계약서 (2022.01.10 체결)','연봉제 임금계약','매월 25일 지급 · 계좌이체','기본 근무유형',true,'주 40시간','기본 초과근무 보상정책','입사일 기준 부여','반차 단위 사용','연차 촉진 사용','채용과 성과관리 프로세스를 총괄하고 있어요.','40시간','6일',2,1)
  RETURNING id INTO u3;
  INSERT INTO member_leave_history (member_id, reason, period) VALUES (u3, '육아휴직', '2023.05~2023.11');
  INSERT INTO member_career (member_id, company, role, period) VALUES (u3, '전 직장 B', 'HR 담당자', '2018~2022');
  INSERT INTO member_education (member_id, school, major, period) VALUES (u3, 'OO대학교', '심리학', '2012~2016');
  INSERT INTO member_family (member_id, name, relation) VALUES (u3, '이OO', '자녀');

  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, work_type_name, work_type_fixed, work_type_hours, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('최지우','CS팀','담당자','jiwoo.choi@selfdiylab.com','2025003','2025-02-03','2025-02-03','계약직','1997-08-15','010-6666-7777','기본 근무유형',true,'주 40시간','입사일 기준 부여','반차 단위 사용','연차 촉진 미사용','24시간','3일',1,0)
  RETURNING id INTO u4;

  INSERT INTO members (name, team, position, email, employee_no, hire_date, group_hire_date, hire_type, birthday, phone, address, labor_contract, wage_contract, salary_pay_info, work_type_name, work_type_fixed, work_type_hours, leave_policy_basis, leave_policy_half_day, leave_policy_promotion, intro, worked_hours, leave_left, deduction_basic, deduction_health_dependents)
  VALUES ('이도현','경영지원팀','대표','dohyun.lee@selfdiylab.com','2020001','2020-01-02','2020-01-02','정규직','1988-04-09','010-9999-0000','서울시 강남구','대표 근로계약서','연봉제 임금계약','매월 25일 지급 · 계좌이체','기본 근무유형',true,'주 40시간','입사일 기준 부여','반차 단위 사용','연차 촉진 미사용','SelfDIYLab을 이끌고 있어요.','40시간','15일',1,0)
  RETURNING id INTO u5;

  INSERT INTO holidays (name) VALUES ('1월 1일'),('설날'),('3·1절'),('어린이날'),('현충일'),('광복절'),('추석'),('성탄절');

  INSERT INTO jobs (title, team, deadline, status, stages, submission_docs, pre_questions, extra_info)
  VALUES ('프론트엔드 개발자 (3년 이상)','개발팀','2026-08-15','진행중',
    '["접수","서류심사","실무면접","임원면접","처우협의"]'::jsonb,
    '[{"name":"이력서","required":true},{"name":"포트폴리오","required":false}]'::jsonb,
    '[{"q":"우리 회사에 지원한 이유를 알려주세요","required":true}]'::jsonb,
    '{"education":true,"career":true,"military":false,"veteran":false,"disability":false}'::jsonb)
  RETURNING id INTO j1;

  INSERT INTO jobs (title, team, deadline, status, stages, submission_docs, pre_questions, extra_info)
  VALUES ('HR 매니저 (성과관리 담당)','피플팀','2026-08-10','진행중',
    '["접수","서류심사","실무면접","처우협의"]'::jsonb,
    '[{"name":"이력서","required":true}]'::jsonb,
    '[]'::jsonb,
    '{"education":true,"career":true,"military":false,"veteran":false,"disability":false}'::jsonb)
  RETURNING id INTO j2;

  INSERT INTO candidates (job_id, name, phone, stage) VALUES (j1, '김서연', '010-1234-5678', '서류심사') RETURNING id INTO c1;
  INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES
    (c1, '2026-07-20', '접수', '지원서 접수'),
    (c1, '2026-07-24', '서류심사', '서류심사 진행중');

  INSERT INTO candidates (job_id, name, phone, stage) VALUES (j1, '박준혁', '010-2222-3333', '실무면접') RETURNING id INTO c2;
  INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES
    (c2, '2026-07-18', '접수', '지원서 접수'),
    (c2, '2026-07-22', '서류심사', '서류 통과'),
    (c2, '2026-07-27', '실무면접', '1차 면접 일정 확정');

  INSERT INTO candidates (job_id, name, phone, stage) VALUES (j2, '이하은', '010-4444-5555', '접수') RETURNING id INTO c3;
  INSERT INTO candidate_history (candidate_id, date, stage, note) VALUES
    (c3, '2026-07-25', '접수', '지원서 접수');

  INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target) VALUES
    ('2026-Q3','회사','신뢰받는 채용 브랜드로 성장한다','경영진', NULL, 82, '%', 100) RETURNING id INTO o1;
  INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target) VALUES
    ('2026-Q3','조직','채용 리드타임 30일 이내로 단축','피플팀', o1, 58, '%', 100) RETURNING id INTO o2;
  INSERT INTO okrs (quarter, level, title, owner, parent_id, progress, unit, target) VALUES
    ('2026-Q3','개인','전 구성원 목표 등록률 100% 달성','이도현', o2, 95, '%', 100);

  INSERT INTO evals (quarter, employee_id, common, lead, job, performance, custom, strength, improve) VALUES
    ('2026-Q2', u1, 5,4,5,5,4, '목표 초과 달성, 협업 리더십이 뛰어남', '문서화 습관을 조금 더 보완하면 좋겠음'),
    ('2026-Q2', u2, 3,2,3,3,3, '꾸준하고 안정적인 업무 처리', '새로운 시도에 조금 더 적극적이면 좋겠음'),
    ('2026-Q2', u3, 4,3,5,2,4, '문제 해결 역량이 뛰어남', '목표 대비 실행 속도를 높일 필요가 있음'),
    ('2026-Q2', u4, 2,2,2,2,2, '맡은 업무는 성실히 수행함', '역할 재정의 및 집중 코칭이 필요함');

  INSERT INTO calibration_cycles (quarter, target_s, target_a, target_b, target_c, target_d) VALUES ('2026-Q2', 10, 20, 40, 20, 10);

  INSERT INTO oneonones (employee_id, date, note) VALUES
    (u1, '2026-07-05', '2분기 목표 중간 점검, 신규 캠페인 리드 역할 논의'),
    (u2, '2026-07-12', '업무 우선순위 조정, 사이드 프로젝트 관심사 공유'),
    (u1, '2026-07-19', '승진 트랙 관련 피드백 전달');
END $$;
