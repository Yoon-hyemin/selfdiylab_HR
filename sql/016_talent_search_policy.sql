-- sql/016_talent_search_policy.sql
--
-- 2026-08-19: 인재검색 자동화 Phase 1B-1. 회사 전체에 적용되는 채점 정책
-- (Level1 문턱값, 공통 40점, 직무 60점 기본 배점, 근거계수, 추천 임계값,
-- 하루 추천상한)을 저장한다. talent_search_projects(sql/015, Phase 1A)와
-- 달리 프로젝트별이 아니라 회사 전체 공용 설정이라 project_id가 없다.
--
-- status는 okrs.status와 같은 컨벤션으로 DB CHECK 제약 없이 앱 레벨에서만
-- 관리한다(draft/active/superseded). 이번엔 시드 행 하나만 바로 active로
-- 넣는다 -- 초안/적용 전환 로직은 1B-4에서 추가한다.
CREATE TABLE talent_search_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_no integer NOT NULL,
  level1_rules jsonb NOT NULL,
  common_fit_weights jsonb NOT NULL,
  evidence_coefficients jsonb NOT NULL,
  job_fit_default_weights jsonb NOT NULL,
  rounding_rule jsonb NOT NULL,
  thresholds jsonb NOT NULL,
  sort_tiebreak_rules jsonb NOT NULL,
  daily_recommend_cap_default integer NOT NULL DEFAULT 50,
  daily_recommend_cap_absolute_max integer NOT NULL DEFAULT 50,
  data_retention_months integer NOT NULL DEFAULT 12,
  status text NOT NULL DEFAULT 'draft',
  change_reason text,
  created_by uuid REFERENCES accounts(id),
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_no)
);

-- 시드: 원본 명세서(인재검색_자동화_마스터프롬프트_원본.md 5~7장) 초기값 그대로.
-- 공통 40점: 12+8+8+7+5=40. 직무 60점: 30+10+8+6+4+2=60.
INSERT INTO talent_search_policy_versions (
  version_no, level1_rules, common_fit_weights, evidence_coefficients,
  job_fit_default_weights, rounding_rule, thresholds, sort_tiebreak_rules,
  daily_recommend_cap_default, daily_recommend_cap_absolute_max,
  data_retention_months, status, change_reason, applied_at
) VALUES (
  1,
  '{"resumeUpdated":{"passWithinDays":90,"verifyWithinDays":180},
    "shortTenure":{"monthsThreshold":12,"lookbackYears":5,"countThreshold":2,
      "exceptions":["인턴","계약만료","프로젝트완료","폐업","구조조정","관계사이동"]},
    "careerGap":{"ignoreUnderMonths":6,"verifyUnderMonths":12}}'::jsonb,
  '[{"key":"ownership","label":"목표완결성·오너십","points":12},
    {"key":"resultOriented","label":"성과·수치 중심 사고","points":8},
    {"key":"problemSolving","label":"문제해결·재발방지","points":8},
    {"key":"execution","label":"실행력·운영 정확성","points":7},
    {"key":"collaboration","label":"협업·조율 능력","points":5}]'::jsonb,
  '{"none":0.5,"weak":0.65,"partial":0.8,"clear":1.0}'::jsonb,
  '[{"key":"coreExperience","label":"핵심 업무 직접 경험","points":30},
    {"key":"seniorityScope","label":"직급·독립 수행 범위","points":10},
    {"key":"similarResults","label":"유사 성과·결과","points":8},
    {"key":"toolsPortfolio","label":"도구·자격·포트폴리오","points":6},
    {"key":"industryFit","label":"산업·사업환경 적합성","points":4},
    {"key":"niceToHave","label":"우대조건","points":2}]'::jsonb,
  '{"unit":0.5,"tieBreak":"roundUp"}'::jsonb,
  '{"totalScoreMin":70,"jobFitScoreMin":42,"minMeaningfulEvidenceCount":2}'::jsonb,
  '["totalScoreDesc","jobFitScoreDesc","evidenceCoverageDesc","resumeUpdatedAtDesc","candidateIdAsc"]'::jsonb,
  50, 50, 12, 'active', '초기값 (원본 명세서 기준값 그대로 시드)', now()
);
