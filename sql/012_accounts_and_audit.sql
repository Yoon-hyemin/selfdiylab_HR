-- 2026-08-07: 개인 계정 기반 로그인·권한관리 도입.
--
-- 지금까지는 로그인이 두 갈래였다 -- 인사/채용은 공용 비밀번호(HR_PASSWORD)
-- 하나로 잠금 해제, 목표/마이페이지는 이메일만 맞으면 그 사람으로 인정
-- (handlers/member-login.js). 둘 다 "그 사람 본인인지" 검증이 없다. 이 두
-- 방식을 개인 계정(비밀번호 있음) + 3단계 시스템 권한(ADMIN/DEPARTMENT_HEAD/
-- EMPLOYEE)으로 대체한다.
--
-- 직책(members.position, 예: '팀장')과 시스템 권한을 같은 값으로 쓰지 않는다
-- -- 별도 테이블(accounts)에 별도 컬럼(system_role)로 관리한다. 기존
-- members.roles(배열, 관리자/부서장/팀원 -- sql/007)는 그대로 남겨두고
-- 건드리지 않는다: 이번 마이그레이션 이후에도 목표 탭 로직이 완전히
-- accounts.system_role로 갈아타기 전까지는 과거 데이터 조회용으로 유지한다.
--
-- department_id는 새 부서 테이블을 만들지 않고 members.team의 문자열 값을
-- 그대로 담는다 -- 이 프로젝트에는 애초에 정규화된 부서 엔터티가 없고
-- (okrs.owner/members.team 전부 자유 텍스트), 이번 작업 범위에서 그걸
-- 새로 만들면 기존 OKR 코드 전체를 건드리게 돼서 범위를 벗어난다. 계정
-- 생성 시 연결된 구성원의 team 값을 그대로 복사해 넣는다.

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL UNIQUE REFERENCES members(id) ON DELETE RESTRICT,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  system_role text NOT NULL DEFAULT 'EMPLOYEE' CHECK (system_role IN ('ADMIN','DEPARTMENT_HEAD','EMPLOYEE')),
  department_id text NOT NULL DEFAULT '',
  account_status text NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','INACTIVE')),
  must_change_password boolean NOT NULL DEFAULT true,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz,
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- email은 로그인 아이디라 대소문자를 구분하면 안 된다. 앱 레벨에서 항상
-- 소문자로 정규화해 저장하지만(handlers/_lib/accountAuth.js), DB 차원에서도
-- 대소문자만 다른 중복을 막아둔다.
CREATE UNIQUE INDEX accounts_email_lower_idx ON accounts (lower(email));

-- 감사 로그. actor/target은 계정이 삭제돼도(이 프로젝트는 계정을 삭제하지
-- 않고 비활성화만 하지만, 방어적으로) 로그 자체는 남도록 SET NULL.
-- 비밀번호·세션 토큰 값은 절대 metadata에 넣지 않는다(코드 레벨 규칙).
CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);
