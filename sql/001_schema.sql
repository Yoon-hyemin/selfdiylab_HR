CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  nickname text DEFAULT '',
  team text DEFAULT '',
  position text DEFAULT '',
  email text DEFAULT '',
  personal_email text DEFAULT '',
  employee_no text DEFAULT '',
  hire_date date,
  group_hire_date date,
  hire_type text DEFAULT '',
  rrn text DEFAULT '',
  birthday date,
  phone text DEFAULT '',
  address text DEFAULT '',
  labor_contract text DEFAULT '',
  wage_contract text DEFAULT '',
  salary_pay_info text DEFAULT '',
  work_type_name text DEFAULT '',
  work_type_fixed boolean DEFAULT true,
  work_type_hours text DEFAULT '',
  overtime_policy text DEFAULT '',
  leave_policy_basis text DEFAULT '',
  leave_policy_half_day text DEFAULT '',
  leave_policy_promotion text DEFAULT '',
  hr_info text DEFAULT '',
  intro text DEFAULT '',
  worked_hours text DEFAULT '',
  leave_left text DEFAULT '',
  special_notes text DEFAULT '',
  deduction_basic integer DEFAULT 1,
  deduction_health_dependents integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE member_leave_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reason text DEFAULT '',
  period text DEFAULT ''
);

CREATE TABLE member_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title text DEFAULT '',
  date date
);

CREATE TABLE member_discipline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  reason text DEFAULT '',
  date date
);

CREATE TABLE member_career (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  company text DEFAULT '',
  role text DEFAULT '',
  period text DEFAULT ''
);

CREATE TABLE member_education (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  school text DEFAULT '',
  major text DEFAULT '',
  period text DEFAULT ''
);

CREATE TABLE member_family (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  name text DEFAULT '',
  relation text DEFAULT ''
);

CREATE TABLE holidays (
  id serial PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  team text DEFAULT '',
  deadline date,
  status text NOT NULL DEFAULT '진행중',
  stages jsonb NOT NULL DEFAULT '[]',
  submission_docs jsonb NOT NULL DEFAULT '[]',
  pre_questions jsonb NOT NULL DEFAULT '[]',
  extra_info jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text DEFAULT '',
  email text,
  self_intro text,
  stage text NOT NULL DEFAULT '접수',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE candidate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT current_date,
  stage text,
  note text
);

CREATE TABLE okrs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter text NOT NULL,
  level text NOT NULL,
  title text NOT NULL,
  owner text DEFAULT '-',
  parent_id uuid REFERENCES okrs(id) ON DELETE SET NULL,
  progress integer DEFAULT 0,
  unit text DEFAULT '%',
  target integer DEFAULT 100
);

CREATE TABLE evals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter text NOT NULL,
  employee_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  common integer,
  lead integer,
  job integer,
  performance integer,
  custom integer,
  strength text,
  improve text
);

CREATE TABLE calibration_cycles (
  quarter text PRIMARY KEY,
  target_s integer DEFAULT 10,
  target_a integer DEFAULT 20,
  target_b integer DEFAULT 40,
  target_c integer DEFAULT 20,
  target_d integer DEFAULT 10
);

CREATE TABLE calibration_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter text NOT NULL REFERENCES calibration_cycles(quarter) ON DELETE CASCADE,
  eval_id uuid NOT NULL REFERENCES evals(id) ON DELETE CASCADE,
  grade text NOT NULL,
  reason text DEFAULT '',
  UNIQUE(quarter, eval_id)
);

CREATE TABLE oneonones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date date NOT NULL,
  note text DEFAULT ''
);
