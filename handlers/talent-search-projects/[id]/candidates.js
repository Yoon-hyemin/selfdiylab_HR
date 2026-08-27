/**
 * handlers/talent-search-projects/[id]/candidates.js
 *
 * GET  -> 200 { candidates: [{ id, name, platform, resumeAgeDays,
 *              shortTenureCount, gapMonths, evidencePattern, manualStatus,
 *              createdAt }] } (생성순) | 404
 * POST {} -> 201 { candidates: [...] } (같은 모양) | 404 | 400
 *
 * Phase 1E-1: 가상 후보 생성 + 조회. 원본 명세가 실제 플랫폼에서 이력서를
 * 가져오는 걸로 그리지만, Phase 1은 실제 접근 없이 무작위 특성을 가진
 * 가상 후보를 서버가 만들어 저장하는 시뮬레이션이다. 점수/판정은 저장하지
 * 않는다 -- index.html의 evaluateLevel1/scoreItemGroup/simulateCandidate
 * (1B-4c에서 만든 채점 엔진)가 화면에서 매번 계산한다. POST는 재호출
 * 시(="다시 생성") 기존 후보를 지우고 새로 만든다 -- 하나의 트랜잭션
 * 안에서 DELETE 다음 여러 INSERT를 실행해 원자적으로 처리한다.
 */
import { sql } from '../../_lib/db.js';
import { requireTalentSearchAccess } from '../../_lib/accountAuth.js';

const EVIDENCE_LEVELS_WEIGHTED = ['없음', '약함', '약함', '부분', '부분', '명확'];

function candidate_out(row) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    resumeAgeDays: row.resume_age_days,
    shortTenureCount: row.short_tenure_count,
    gapMonths: row.gap_months,
    evidencePattern: row.evidence_pattern,
    manualStatus: row.manual_status,
    createdAt: row.created_at
  };
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomEvidencePattern() {
  const pattern = [];
  for (let i = 0; i < 5; i++) {
    pattern.push(EVIDENCE_LEVELS_WEIGHTED[randomInt(0, EVIDENCE_LEVELS_WEIGHTED.length - 1)]);
  }
  return pattern;
}

function generateVirtualCandidates(count, platforms) {
  const candidates = [];
  for (let i = 1; i <= count; i++) {
    candidates.push({
      name: `가상후보-${String(i).padStart(3, '0')}`,
      platform: platforms[randomInt(0, platforms.length - 1)],
      resumeAgeDays: randomInt(0, 250),
      shortTenureCount: randomInt(0, 4),
      gapMonths: randomInt(0, 20),
      evidencePattern: randomEvidencePattern()
    });
  }
  return candidates;
}

export default async function handler(req, res) {
  const account = await requireTalentSearchAccess(req, res);
  if (!account) return;

  const { id } = req.query;

  if (req.method === 'GET') {
    try {
      const [project] = await sql`SELECT id FROM talent_search_projects WHERE id = ${id}`;
      if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });

      // 한 배치의 모든 INSERT가 같은 트랜잭션 안에서 실행되고 Postgres now()는
      // 트랜잭션 시작 시각으로 고정되므로, created_at만으로는 배치 내 순서가
      // 보장되지 않는다(전부 동일 값). name은 `가상후보-NNN`로 3자리
      // zero-pad돼 있어 문자열 정렬이 곧 생성 순서와 일치한다 -- 그래서
      // 보조 정렬키로 추가해 실제 생성순(created_at, name)을 보장한다.
      const rows = await sql`SELECT * FROM talent_search_candidates WHERE project_id = ${id} ORDER BY created_at, name`;
      return res.status(200).json({ candidates: rows.map(candidate_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '가상 후보 목록을 불러오지 못했어요' });
    }
  }

  if (req.method === 'POST') {
    try {
      const [project] = await sql`SELECT * FROM talent_search_projects WHERE id = ${id}`;
      if (!project) return res.status(404).json({ error: '검색 프로젝트를 찾을 수 없어요' });
      if (project.status !== 'approved') {
        return res.status(400).json({ error: '승인된 프로젝트만 가상 후보를 생성할 수 있어요' });
      }
      // 방어적 가드: 프로젝트 생성 검증(validateTalentSearchProjectInput)이 플랫폼
      // 최소 1개를 이미 강제하므로 지금은 도달 불가능하지만, platforms가 비어있으면
      // randomInt(0, -1)이 undefined를 골라 NOT NULL 제약 위반으로 일반 500이
      // 나는 걸 막기 위해 명시적으로 막아둔다.
      if (!Array.isArray(project.platforms) || project.platforms.length === 0) {
        return res.status(400).json({ error: '이 프로젝트에 선택된 플랫폼이 없어요' });
      }

      const count = Math.min(300, Math.max(100, project.target_recommend_count * 3));
      const candidates = generateVirtualCandidates(count, project.platforms);

      const statements = [
        sql`DELETE FROM talent_search_candidates WHERE project_id = ${id}`,
        ...candidates.map(c => sql`
          INSERT INTO talent_search_candidates (
            project_id, name, platform, resume_age_days, short_tenure_count, gap_months, evidence_pattern
          ) VALUES (
            ${id}, ${c.name}, ${c.platform}, ${c.resumeAgeDays}, ${c.shortTenureCount}, ${c.gapMonths}, ${JSON.stringify(c.evidencePattern)}::jsonb
          ) RETURNING *`)
      ];
      const result = await sql.transaction(statements);
      const inserted = result.slice(1).map(r => r[0]);

      return res.status(201).json({ candidates: inserted.map(candidate_out) });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: '가상 후보를 생성하지 못했어요' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
