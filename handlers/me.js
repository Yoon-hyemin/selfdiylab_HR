/**
 * handlers/me.js
 *
 * GET -> 200 { id, name, team, roles }  로그인한 본인 정보 (team/roles는
 * "우리 팀 달성률" 계산과 목표 탭 역할별 화면 렌더링에 쓰이는, 본인만의
 * 정보라 공개 API(public-data)에는 안 내려가는 값들을 여기서만 노출한다).
 *
 * 2026-08-05: role(단일 값) -> roles(배열)로 변경. 인사팀장처럼 "관리자이면서
 * 동시에 자기 팀의 부서장"인 실사용 사례가 나와서, 한 사람이 관리자/부서장을
 * 동시에 가질 수 있게 했다. '팀원'은 독립 권한이 없는 기본 상태라 빈 배열도
 * 팀원과 동일하게 취급한다(아래 fallback).
 */
import { sql } from './_lib/db.js';
import { requireMemberAuth } from './_lib/memberSession.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const memberId = requireMemberAuth(req, res);
  if (!memberId) return;

  try {
    const rows = await sql`SELECT id, name, team, roles FROM members WHERE id = ${memberId}`;
    if (!rows.length) return res.status(401).json({ error: '로그인이 필요해요' });
    const roles = rows[0].roles && rows[0].roles.length ? rows[0].roles : ['팀원'];
    res.status(200).json({ id: rows[0].id, name: rows[0].name, team: rows[0].team || '', roles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '내 정보를 불러오지 못했어요' });
  }
}
