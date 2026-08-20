# 세션 인수인계 — 2026-08-19

이 문서는 컨텍스트가 꽉 찬 세션을 이어받는 새 세션을 위한 것이다. "확인됨"은 실제로 코드/DB/터미널 출력으로 검증한 것이고, "미확인"은 검증 없이 적어둔 추정이니 구분해서 읽을 것. 이전(2026-08-07) 인수인계 문서 내용은 이번 세션과 무관한 다른 작업(기간형 기업 목표)에 대한 것이라 이 문서로 완전히 대체한다.

## 1. 현재 작업의 목적

**인재검색 자동화** 기능을 이 HR 시스템에 새로 추가하는 중이다. 사용자(윤혜민)가 GPT로 작성해온 매우 상세한 원본 제품 명세(`인재검색_자동화_마스터프롬프트_원본.md`, 저장소 루트, 각색 없이 원문 보존)를 기반으로, "검색·평가 실행 엔진은 로컬 프로그램(크롬 확장 포함)으로 분리하고, 나머지(검색 프로젝트 관리·기준 설정/승인·진행상황·추천결과)는 이 HR 웹사이트에 통합"하는 방향으로 각색해서 단계별로 만들고 있다.

**지금까지 완료한 단계**: Phase 1A(화면 골격+권한 플래그) → Phase 1B-1(기준 관리센터 데이터구조+읽기전용) → Phase 1B-2(Level1+공통40점 실제 수정 가능). **다음은 Phase 1B-3(직무 60점 + 임계값·하루상한 수정 가능하게)부터 시작하면 된다.**

## 2. 사용자가 이미 확정한 결정사항 (확인됨 — 대화로 직접 확인)

- **아키텍처**: 실행엔진(크롬 조작)은 로컬 프로그램으로 분리, 관리 화면(기준 설정, 프로젝트 관리, 결과 조회)은 이 HR 웹사이트(Vercel+Neon)에 통합. 여러 컴퓨터에서 실행엔진을 각자 돌려야 함(기업회원 계정 하나를 팀이 공유해서 씀 — 플랫폼 동시 로그인 충돌 방지용 "플랫폼 사용 잠금" 화면이 나중 단계에 필요, 아직 구현 안 함).
- **Neon 브랜치 분리(2026-08-19 도입)**: 이 세션 작업 중, 로컬 개발과 실제 서비스가 같은 Neon 브랜치(`production`)를 쓰고 있었다는 걸 뒤늦게 발견 → `production`에서 `development` 브랜치를 새로 분기해서 분리했다(CLAUDE.md의 "Neon 브랜치 분리" 절 참고, 프로젝트 전체에 적용되는 새 규칙). **지금 `.env.local`은 `development` 브랜치를 가리켜야 하며, 실제로 그렇게 돼 있다(확인됨).** `production` 브랜치에 스키마 변경을 반영하는 건 항상 사용자 확인 후 별도로 진행 — 아직 sql/015, sql/016 둘 다 production에는 미적용.
- **권한**: "인재검색" 메뉴 전체(대시보드, 기준 관리센터 포함)는 `accounts.system_role==='ADMIN' || accounts.can_use_talent_search`로 연다 — **ADMIN 전용이 아니다.** 사용자가 명시적으로 확인: "담당자한테만 열어줄 것이라서 굳이 더 좁힐 필요 없음". 서버 헬퍼는 `handlers/_lib/accountAuth.js`의 `requireTalentSearchAccess(req, res)`.
- **공통 40점 항목은 개수가 고정이 아니다** — 처음엔 "이름·배점만 수정, 항목 자체는 5개 고정"으로 설계했다가, 사용자가 명시적으로 "항목 추가/삭제도 가능하게" 요청해서 뒤집었다. 지금 구현은 최소 1개, 개수 무제한, 합계 정확히 40이면 통과.
- **정책 수정 = 즉시 새 버전 생성+적용**(초안 단계 없음). 초안/버전이력/복구/가상후보 미리보기는 Phase 1B-4에서 별도로 추가하기로 이미 정해져 있다.
- **사용자는 디자인 완성도보다 기능을 우선한다고 명시함**("디자인 좀 밋밋한데 일단 기능먼저 만들자") — 이후 라운드에서도 디자인 폴리싱보다 기능 진행을 우선할 것.
- **작업 방식**: 매 서브 단계(1A, 1B-1, 1B-2 등)마다 brainstorming 스킬(설계 문서 작성 → `docs/superpowers/specs/`) → writing-plans 스킬(구현계획 → `docs/superpowers/plans/`) → subagent-driven-development 스킬(서브에이전트로 Task별 구현+리뷰+최종 전체검토) 순서를 반복해왔다. **다음 세션도 이 패턴을 그대로 따르면 된다** — 사용자가 이 방식에 이미 익숙하고 매번 "서브에이전트 방식으로 진행"을 선택해왔다.
- CLAUDE.md는 매 서브 단계가 끝날 때마다 그 내용을 반영해서 갱신해왔다(확인됨 — 지금 CLAUDE.md를 열어보면 "인재검색 자동화" 전체 절과 Phase 1A/1B-1/1B-2 하위 절이 이미 다 들어있음). **새 세션은 먼저 CLAUDE.md의 "인재검색 자동화" 절을 읽으면 이 기능의 현재 상태를 대부분 파악할 수 있다** — 이 HANDOFF.md는 그걸 보완하는 세션 진행 상태·다음 행동 요약이다.

## 3. 완료된 작업 (전부 커밋 완료, 확인됨 — `git log`로 검증)

브랜치: `claude/talent-search-automation-fff2d5` (아직 `master`에 머지 안 함 — 사용자가 명시적으로 "머지는 나중에, 지금은 다음 단계 진행" 선택함).

**Phase 0** (`38770af`, `cfd8fb6`, `c06c5fa`) — 원본 명세 보존, 이 저장소 통합용 설계 문서 작성.

**Phase 1A** (`f437b56`→`958fcf6`, 최종 fix `678cdb9`, CLAUDE.md `ee55423`):
- `sql/015_talent_search.sql` — `accounts.can_use_talent_search`, `talent_search_projects`(빈 테이블)
- `/api/me`에 `canUseTalentSearch` 노출, `PATCH /api/accounts/:id/talent-search-access`
- 계정 관리 화면 체크박스, 사이드바 "🔍 인재검색" 메뉴 + 대시보드(예시 카드 2개)

**Phase 1B-1** (`fbca2c5`→`8cdf5d3`, 최종 fix `b855a64`, CLAUDE.md `cccda74`):
- `sql/016_talent_search_policy.sql` — `talent_search_policy_versions` 테이블 + 원본 명세 초기값 시드(version 1)
- `handlers/_lib/accountAuth.js`에 `requireTalentSearchAccess` 추가
- `GET /api/talent-search-policy`, "인재검색" 화면에 서브탭(대시보드/기준 관리센터) 추가, 읽기전용 표시

**Phase 1B-2** (`775df9f`→`a353574`, 최종 fix `4c55084`, CLAUDE.md `76b7ea6`, UI문구 fix `4a7be66`):
- `handlers/_lib/talentSearchPolicy.js`(신설) — `getActivePolicy`/`policy_out`/`createPolicyVersion` 공유 헬퍼
- `PATCH /api/talent-search-policy/level1-rules`, `PATCH /api/talent-search-policy/common-fit-weights` (+ 각각 단위테스트 `*.test.js`)
- 기준 관리센터에 두 "수정" 모달 추가(공통40점은 항목 자유 추가/삭제)

**현재 HEAD**: `4a7be66`. `git status` 클린(커밋 안 된 변경 없음).

## 4. 지금 검증 환경 상태 (확인됨)

- `.env.local`은 Neon **`development`** 브랜치(안전한 사본, 실제 서비스와 분리됨)를 가리킨다.
- **테스트 계정**: `preview-test@selfdiylab.invalid` / `Preview1234`, ADMIN 권한, `development` 브랜치에만 존재하는 가짜 계정(실제 직원 아님, 안전하게 재사용 가능). 이 세션 중 다른 throwaway 테스트 계정들은 다 만들고 확인 후 삭제해뒀다 — 남아있는 건 이 계정 하나뿐.
- `talent_search_policy_versions`의 현재 활성 버전은 **version 9**, 값은 원본 명세서 초기값으로 복원해둔 상태(확인됨 — 세션 중 수동 테스트로 "새 항목"/"테스트항목" 같은 지저분한 값이 잠깐 활성 버전이 됐었는데, 세션 끝에 원래 값으로 복원하는 새 버전을 만들어서 정리함). 새 세션에서 화면을 열어보면 원본 5개 공통역량(목표완결성·오너십 12점 등)이 정상적으로 보일 것이다.
- 로컬 dev 서버(`node scripts/dev-server.js`)가 포트 3000에 떠 있을 수도, 없을 수도 있다 — 새 세션에서 `preview_start`(launch.json의 `hr-dev-server`)로 다시 띄우거나, 이미 떠 있으면 최신 코드가 반영됐는지 확인 후 필요시 재시작할 것(이 세션 내내 여러 서브에이전트가 이 서버를 껐다 켰다 했음).
- `node_modules`는 이 워크트리에 설치돼 있다(확인됨).

## 5. 알려진 한계 / 다음에 볼 것 (확인됨 — 의도적으로 미룬 것들, CLAUDE.md에도 기록돼 있음)

- **서버 사이드 검증이 아직 얕다**: 숫자 필드(`thresholds`, `jobFitDefaultWeights` 등, 아직 읽기전용)는 `escapeHtml` 없이 그대로 출력 중 — 지금은 시드값이라 위험 없지만, **Phase 1B-3에서 이 필드들이 편집 가능해지면 문자열 필드와 동일하게 이스케이프를 적용할 것.**
- **핸들러 중복**: `level1-rules.js`/`common-fit-weights.js` 두 PATCH 핸들러가 구조가 거의 동일(메서드검사→권한검사→changeReason검사→검증→조회→생성→응답). Phase 1B-3에서 비슷한 핸들러가 2개 더 늘어나면(직무60점, 임계값·하루상한) 공용 팩토리 함수로 묶는 걸 고려할 것.
- **단위테스트가 `DATABASE_URL` 없이는 import 자체가 실패한다**(`handlers/_lib/db.js`가 모듈 최상단에서 throw) — `validateLevel1Rules`/`validateCommonFitWeights`처럼 순수 로직 테스트인데도 핸들러 파일을 통째로 import해서 생기는 문제. 해결하려면 검증 함수를 `handlers/_lib/talentSearchPolicyValidate.js` 같은 DB 의존성 없는 파일로 분리하고 핸들러가 거기서 import하게 바꾸면 된다 — Phase 1B-3에서 새 검증함수를 또 만들 때 같이 고려.
- **동시 수정 시 처리가 거칠다**: 두 사람이 동시에 저장하면 나중 요청이 500(내부 오류 메시지)을 받는다. 우선순위 낮음(내부 소규모 도구, 실사용에서 거의 안 겹침) — 필요해지면 409 응답으로 바꾸는 정도의 간단한 개선.
- **공통 40점 항목을 0개까지 지울 수 있는 UI**: 서버가 "1개 이상" 검증으로 막아주긴 하지만, 마지막 항목의 삭제 버튼을 화면에서 미리 숨기면 더 매끄러움 — 우선순위 낮음.
- **프로덕션 마이그레이션 미적용**: `sql/015_talent_search.sql`, `sql/016_talent_search_policy.sql` 둘 다 `development` 브랜치에만 적용됨. **`master`에 머지해서 실제 배포하기 전에 반드시 사용자 확인 받고 두 파일을 프로덕션 브랜치의 connection string으로 실행해야 한다** — 안 하면 로그인 자체가 500(accounts 테이블에 컬럼이 없어서) 나거나 기준 관리센터 탭이 500 난다.

## 6. 다음 세션에서 가장 먼저 할 일

1. `.env.local`이 여전히 `development` 브랜치를 가리키는지 확인(`cat .env.local`로 호스트명 확인).
2. 로컬 dev 서버 띄우고(`preview_start` with `hr-dev-server`, 또는 이미 떠있으면 재사용), `preview-test@selfdiylab.invalid`/`Preview1234`로 로그인해서 "인재검색 → 기준 관리센터"가 정상 상태(버전 9, 원본 초기값)로 보이는지 한 번 확인.
3. 사용자에게 **Phase 1B-3(직무 60점 + 추천 임계값·하루 추천상한 수정 가능하게)**를 시작할지 확인 — 이미 그 방향으로 합의돼 있었으므로(이 문서 1절), 바로 brainstorming 스킬로 들어가면 된다. 참고할 문서: `docs/superpowers/specs/2026-08-19-talent-search-phase1b1-policy-schema-design.md`(정책 스키마 전체), `인재검색_자동화_마스터프롬프트_원본.md` 7장(직무 60점 로직)·9장(하루상한).
4. `docs/superpowers/plans/2026-08-19-talent-search-phase1b2.md` 안의 "Self-Review"/"실행 순서 안내" 절이 Phase 1B-2 작업의 최종 상태 요약이니, 구조를 참고해서 1B-3 계획도 같은 형식으로 쓰면 된다.

## 7. 절대 바뀌면 안 되는 원칙 (CLAUDE.md에 이미 확정, 확인됨)

- 4단계 작업 방식: 구획화 개발 → 실제 인물로 확인 → 배포 → 수정. 여러 기능을 한 번에 묶어 제안하지 않는다.
- 새 API 엔드포인트는 `api/[...path].js`의 import + `ROUTES` 배열에 반드시 등록(안 하면 로컬은 되는데 Vercel 배포에서 404남).
- API 응답 camelCase, DB 컬럼 snake_case.
- 인재검색 관련 API는 `requireRole`이 아니라 `requireTalentSearchAccess`를 쓴다(ADMIN 전용이 아니므로).
- 새 Neon 스키마 변경은 먼저 `development` 브랜치에서 검증하고, `production` 반영은 항상 사용자 확인 후 별도 진행.
- 프로젝트 전체 원칙: 서버는 원본 row만 반환, 집계/계산은 클라이언트에서 매 렌더마다 계산.
- 실제 직원 계정은 절대 테스트용으로 건드리지 않는다(이 세션 중 한 번 실수로 real 계정 플래그를 건드렸다가 즉시 되돌린 사고가 있었음 — 이후로는 반드시 `preview-test@selfdiylab.invalid` 같은 전용 throwaway 계정만 사용).
