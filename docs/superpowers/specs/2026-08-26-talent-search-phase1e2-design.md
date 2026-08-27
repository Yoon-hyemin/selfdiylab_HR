# 인재검색 Phase 1E-2 — 후보 상세보기 + 수동 평가(정보부족/중복)

- 작성일: 2026-08-26
- 선행 문서: `docs/superpowers/specs/2026-08-26-talent-search-phase1e1-design.md`(1E-1, 가상 후보 생성+목록)
- 관련 기존 파일: `handlers/talent-search-projects/[id]/candidates.js`(GET/POST), `index.html`의 `renderTalentSearchCandidatesScreen`/`simulateCandidate`(1B-4c)

## 배경

1E-1에서 후보 목록(추천/확인필요/제외 자동판정)까지 만들었다. 원본 명세 1E 항목의 "정보 부족"/"중복"은 사람이 실제로 후보를 열어봐야 판단 가능한 상태라 1E-1에서 미뤄뒀다. 이번엔 목록의 각 행을 클릭하면 상세(원본 raw 속성 + 채점 세부)를 보여주는 모달을 열고, 거기서 "정보 부족"/"중복"으로 수동 표시하거나 표시를 해제할 수 있게 한다.

## 범위

**포함**: 후보 상세 모달, 수동 상태 저장 API, 목록/카운트에 수동 상태 반영(수동 상태가 있으면 자동판정보다 우선 표시).
**포함 안 함**: 실제 이력서 원문(가상 후보라 애초에 없음), 후보 삭제, 일괄 처리, 대시보드 연동.

## 데이터 구조

`sql/020_talent_search_candidate_manual_status.sql`:
```sql
ALTER TABLE talent_search_candidates
  ADD COLUMN IF NOT EXISTS manual_status text;
```
값은 `NULL`(기본, 자동판정 그대로 사용) / `'insufficient_info'`(정보 부족) / `'duplicate'`(중복) — 다른 `status` 컬럼들과 같은 컨벤션으로 DB CHECK 없이 앱 레벨 관리.

## API

`PATCH /api/talent-search-projects/:id/candidates/:candidateId` — `requireTalentSearchAccess`. 바디 `{ manualStatus: 'insufficient_info' | 'duplicate' | null }`(그 외 값은 400). 대상 후보가 그 프로젝트 소속이 아니면 404. 성공 시 `200 { id, manualStatus }`.

## 화면

`renderTalentSearchCandidatesScreen`의 표 행에 `onclick`을 달아 클릭하면 상세 모달(`openTalentSearchCandidateDetail`)을 연다 — 후보명/플랫폼, 이력서 최신성/단기근속/경력공백 raw 값, Level1 판정, 공통40점/직무60점/총점, 지금 상태(자동판정 또는 수동상태) + 라디오/버튼으로 "정보 부족"/"중복"/"수동 표시 해제" 선택 → 저장 시 PATCH 호출 후 목록 다시 그림.

판정 컬럼: `candidate.manualStatus`가 있으면 "정보 부족"/"중복" 배지, 없으면 기존처럼 자동판정 배지. 요약 카운트도 수동상태 2개를 추가해 5개(총후보/추천/확인필요/제외/정보부족·중복)로 늘린다 — 수동상태가 있는 후보는 자동판정 카운트에서 빠지고 정보부족/중복 카운트로만 잡힌다.
