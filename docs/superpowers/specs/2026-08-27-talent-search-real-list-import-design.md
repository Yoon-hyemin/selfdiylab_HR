# 인재검색 자동화 — 사람인 실제 후보 리스트 가져오기 설계

- 작성일: 2026-08-27
- 원본 명세: `인재검색_자동화_마스터프롬프트_원본.md`
- 관련 기존 문서: `docs/superpowers/specs/2026-08-19-talent-search-automation-design.md`(Phase 0 전체 아키텍처), `docs/superpowers/specs/2026-08-27-talent-search-execution-engine-ocr-mvp-design.md`(오늘 먼저 완료한 실행엔진 OCR MVP), `docs/superpowers/specs/2026-08-26-talent-search-phase1e1-design.md`(가상 후보 생성 + "검색 진행" 화면)

## 배경

오늘 세션에서 실행엔진 OCR MVP(크롬 확장이 사람인 후보 **상세 이력서** 화면을 스크롤+캡처+로컬OCR로 읽어오는 기능)를 완료했다. 그 다음으로 사용자(윤혜민, HR팀장)가 원한 것은: 사람인 **검색결과 리스트**에서 실제 후보들을 가져와서, 이미 만들어져 있는 HR 웹사이트의 "검색 진행" 화면에 연결하는 것이다. 사용자와의 대화로 다음을 확정했다.

- **채점은 이번 단계에 포함하지 않는다.** 기존 채점엔진(Level1/공통40점/직무60점)은 이력서 전체를 읽었다는 전제로 설계돼 있어서, 리스트 정보만으로는 정확한 판단이 안 된다(특히 경력공백처럼 리스트에 안 나오는 항목). 억지로 부정확한 자동판정을 내는 것보다, 이번엔 **리스트 원본 정보를 그대로 보여주고 사용자가 직접 정렬·필터링**하는 것으로 범위를 좁혔다.
- **검색은 사용자가 직접, 가져오기만 자동화한다.** 원본 명세의 안전원칙("사전 검증 전까지 수동 이동 + 자동 추출·평가 모드를 기본으로 한다")에 따라, 확장은 프로젝트 키워드를 보고 알아서 검색하지 않는다. 사용자가 사람인에서 직접 검색해둔 화면을, 확장이 "지금 보이는 것만" 읽어서 가져온다.
- **한 페이지씩만 가져온다.** 여러 페이지를 자동으로 넘기면서 가져오면 사람인의 봇 탐지에 걸릴 위험이 있다(오늘 이미 2단계인증을 겪었다 — 사람인이 이상행동을 감시하고 있다는 증거). 회사의 실제 유료 채용 계정이 제한되면 업무에 지장이 생기므로, 이번 단계는 버튼 누른 시점에 화면에 보이는 한 페이지(대략 20명)만 가져온다.
- **후보를 클릭하면 실제 이력서로 이동한다.** 리스트는 빠르게 훑어보는 용도이고, 관심 가는 사람은 원문 이력서 링크를 통해 사람인 상세 페이지로 이동해서 오늘 만든 OCR 추출 기능으로 자세히 읽어본다. 이 흐름은 이미 있는 기능(오늘 만든 확장)을 그대로 재사용한다.
- **새 테이블을 따로 만든다.** 기존 `talent_search_candidates`(가상 후보용, `resume_age_days`/`short_tenure_count`/`gap_months`/`evidence_pattern` 같은 "이력서를 다 읽었다는 전제"의 필드로 구성)는 건드리지 않는다. 리스트에서 가져온 실제 후보는 훨씬 단순한 정보만 있으므로 별도 테이블에 저장하고, 화면은 "검색 진행" 안에 새 탭으로 보여준다. 기존 채점 로직·가상 후보 파이프라인은 이번 작업으로 전혀 바뀌지 않는다.
- **크롬 확장이 HR 사이트에 처음 연결될 때는 "연결 코드"로 인증한다.** 확장이 우리 HR 웹사이트 API를 호출하려면 "이 요청이 우리 회사 계정이 맞다"는 확인이 필요하다. 브라우저 세션 쿠키를 재사용하는 방식(더 자동화되지만 기술적으로 더 복잡하고 브라우저 보안정책에 영향받음) 대신, **HR 사이트에서 발급한 코드를 확장에 한 번 붙여넣어두는 방식**을 쓰기로 했다 — 이 코드베이스가 이미 쓰고 있는 "임시 비밀번호를 한 번만 화면에 보여주고 DB에는 해시만 저장" 패턴(계정 관리 화면)과 같은 방식이다.

## 이번 슬라이스 범위

**포함**:
- HR 사이트: 계정별 "연결 코드" 발급 화면 + API
- HR 사이트: 리스트 후보를 저장하는 새 테이블 + 저장/조회 API (연결 코드 인증)
- HR 사이트: "검색 진행" 화면에 새 탭 "실제 후보 리스트" — 정렬·필터 가능한 표, 클릭하면 원문 이력서 링크로 이동
- 크롬 확장: 사람인 검색결과 리스트 페이지에서 "이 페이지 가져오기" 기능(프로젝트 선택 + 현재 화면의 후보들 파싱 + 전송)

**제외 (다음 단계로 미룸)**:
- 자동 채점(Level1/공통40점/직무60점)을 리스트 후보에 적용하는 것
- 여러 페이지 자동 순회
- 중복 후보 처리(같은 사람을 두 번 가져왔을 때 병합/스킵)
- 사람인 외 다른 플랫폼(잡코리아/원티드/리멤버)
- 세션 쿠키 재사용 방식 인증(연결 코드 방식으로 확정)

## 아키텍처

```
[혜민님 PC]
 크롬 확장 (Manifest V3)
   ├─ 사람인 검색리스트 페이지: 리스트 파싱 + "가져오기" 팝업
   └─ (기존, 변경 없음) 사람인 상세 이력서 페이지: OCR 추출
        │
        │  Authorization: Bearer <연결 코드>
        ▼
 HR 웹사이트 API (Vercel)
   ├─ POST /api/talent-search-extension-token   (연결 코드 발급, 쿠키 세션 인증)
   ├─ GET  /api/talent-search-projects          (기존 엔드포인트, 연결 코드 인증도 허용하도록 확장)
   ├─ POST /api/talent-search-projects/:id/list-candidates   (신규, 연결 코드 인증)
   └─ GET  /api/talent-search-projects/:id/list-candidates   (신규, 쿠키 세션 인증 — HR 사이트 화면용)
        │
        ▼
 Neon Postgres
   ├─ talent_search_extension_tokens (신규)
   └─ talent_search_list_candidates  (신규 — 기존 talent_search_candidates와 별개)
```

## 데이터 모델

### `talent_search_extension_tokens` (신규 테이블)

계정 하나당 연결 코드 하나. 코드 값 자체는 저장하지 않고 해시만 저장한다(계정 비밀번호와 같은 원칙).

```sql
CREATE TABLE talent_search_extension_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
```

- 계정당 최대 1개 — 새로 발급하면 기존 걸 대체한다(비밀번호 재설정과 같은 방식, "여러 개 발급해서 관리" 하는 복잡함을 피함).
- `last_used_at`은 이 코드가 실제로 쓰이고 있는지 화면에서 확인할 수 있게(예: "3일 전 마지막 사용") — 나중에 문제 생겼을 때 디버깅용.

### `talent_search_list_candidates` (신규 테이블, 기존 `talent_search_candidates`와 별개)

```sql
CREATE TABLE talent_search_list_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES talent_search_projects(id) ON DELETE CASCADE,
  platform text NOT NULL,
  masked_name text NOT NULL,
  gender text,
  age integer,
  career_summary text,
  recent_positions jsonb NOT NULL DEFAULT '[]',
  education text,
  tags jsonb NOT NULL DEFAULT '[]',
  badges jsonb NOT NULL DEFAULT '[]',
  last_updated_label text,
  source_url text NOT NULL,
  imported_by_account_id uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

- `recent_positions`: 리스트 카드에 보이는 최근 경력 항목들 `[{company, period, note}, ...]` — 그대로 텍스트로 저장, 구조화된 계산(경력공백 등)에는 안 씀(이번 범위 밖).
- `last_updated_label`: 사람인이 보여주는 문자열 그대로 저장(예: "26-06-10 업데이트") — 상대적 날짜 표현이라 정확한 날짜로 변환은 나중에 필요해지면 추가.
- `source_url`: 클릭하면 이동할 원문 이력서 URL. 이번 슬라이스의 핵심 필드 중 하나 — 이게 없으면 "클릭해서 자세히 보기"가 안 됨.
- 중복 제거용 유니크 제약 없음(범위 밖) — 같은 후보를 두 번 가져오면 두 번 저장된다. 이번 화면에서 눈에 띄게 이상하진 않지만(리스트일 뿐 채점 대상이 아니라서), 다음 단계에서 다룰 사항으로 명시해둔다.

## 인증 — 연결 코드

- `handlers/talent-search-extension-token/index.js`(신규): `POST`(코드 발급/재발급, `requireTalentSearchAccess`로 보호 — 기존 쿠키 세션 인증) — 원문 코드를 응답에 딱 한 번 포함하고, DB에는 bcrypt 해시만 저장(계정 임시 비밀번호와 동일 패턴). `GET`(현재 코드 발급 여부·`last_used_at` 조회, 원문은 다시 안 보여줌).
- `handlers/_lib/accountAuth.js`에 `requireExtensionToken(req, res)` 추가: `Authorization: Bearer <코드>` 헤더를 읽어 해시 비교로 계정을 찾고, `can_use_talent_search`(또는 ADMIN) 확인까지 `requireTalentSearchAccess`와 동일하게 수행. 매칭되면 `last_used_at`을 갱신한다.
- **`GET /api/talent-search-projects`는 쿠키 세션과 연결 코드 인증을 둘 다 받아들이도록 바뀐다** — 크롬 확장이 "어느 프로젝트에 넣을지" 목록을 가져올 때 이 엔드포인트를 그대로 재사용하기 위해서다. 기존 쿠키 세션 사용자(HR 사이트 화면)에는 동작 변화 없음.
- 새로 추가하는 `POST/GET .../list-candidates`는 각각 확장 전용(연결 코드만)과 HR 사이트 화면 전용(쿠키 세션만)으로 나뉜다 — 굳이 둘 다 받을 필요가 없어서 단순하게 유지.

## 크롬 확장 변경사항

- `manifest.json`: `host_permissions`에 사람인 검색리스트 페이지(`https://www.saramin.co.kr/zf_user/memcom/talent-pool/*`)와 HR 웹사이트 API 오리진(로컬 개발 `http://localhost:3000/*`, 배포 도메인)을 추가. 새 콘텐츠 스크립트를 검색리스트 페이지 패턴에 등록.
- 새 파일 `list-content.js`(콘텐츠 스크립트): 검색리스트 페이지의 후보 카드들을 파싱해서 `{maskedName, gender, age, careerSummary, recentPositions, education, tags, badges, lastUpdatedLabel, sourceUrl}` 배열을 만든다. 실제 DOM 구조(클래스명 등)는 구현 시점에 라이브 페이지를 직접 확인해서 선택자를 정한다(오늘 상세 페이지 작업 때와 같은 방식 — 이 문서에서 클래스명을 미리 추측해서 못박지 않는다).
- 팝업 UI 확장:
  - **최초 1회 설정**: "연결 코드" 입력칸 — 입력하면 `chrome.storage.local`에 저장. 이후엔 다시 안 물어봄(재설정하려면 다시 입력).
  - 검색리스트 페이지에서 팝업을 열면 상세 페이지 때와 다른 화면이 뜬다: "가져올 프로젝트 선택"(드롭다운, `GET /api/talent-search-projects`를 연결 코드로 호출해서 채움) + "이 페이지 가져오기" 버튼.
  - 클릭하면 `list-content.js`가 파싱한 배열 + 선택한 `projectId`를 `POST .../list-candidates`로 전송, 결과(가져온 인원 수) 표시.
- 기존 상세 페이지 OCR 기능(오늘 만든 것)은 전혀 안 바뀐다 — 완전히 별개의 페이지 패턴에서 동작하는 별개의 기능이 하나 추가되는 것뿐이다.

## HR 웹사이트 화면 변경사항

- "계정 및 권한 관리" 화면(또는 새 별도 위치 — 구현 시 기존 화면 레이아웃을 보고 자연스러운 자리에 배치): "연결 코드 발급/재발급" 버튼. 누르면 코드가 한 번 화면에 뜨고, 복사해서 확장에 붙여넣으라는 안내.
- "인재검색 → 검색 진행" 화면에 새 서브탭 "실제 후보 리스트" 추가. `GET .../list-candidates`로 불러와서 표로 표시: 이름(마스킹)·성별/나이·경력요약·학력·태그·최종업데이트·가져온 날짜. 나이·경력·태그로 정렬/필터 가능(클라이언트에서 계산, 이 프로젝트의 기존 원칙과 동일). 행 클릭 → `source_url`을 새 탭으로 열기.
- 기존 "가상 후보" 관련 화면(생성 버튼, 자동판정 표)은 전혀 안 바뀐다 — 완전히 별개의 새 탭이 추가되는 것뿐이다.

## 안전장치

- 확장은 사람인 검색을 대신 실행하지 않는다 — 사용자가 이미 만들어둔 검색 결과 화면만 읽는다.
- 한 번 클릭 = 현재 화면에 보이는 한 페이지만 가져온다. 자동으로 다음 페이지로 넘어가지 않는다.
- 로그인/인증 화면 감지 시 중단하는 원칙(오늘 만든 것)은 이 새 콘텐츠 스크립트에도 동일하게 적용한다.
- 연결 코드는 계정 비밀번호와 동일한 수준으로 취급 — 평문 저장 안 함, 화면에 한 번만 노출.

## 테스트

- 연결 코드 발급/재발급 API, `requireExtensionToken` 헤더 파싱 로직은 순수 로직 부분만 `node --test`.
- 실제 사람인 검색리스트 페이지에서 "가져오기" 실행 → HR 사이트 새 탭에 정확한 인원 수·필드가 뜨는지 수동 확인.
- 리스트 후보 클릭 → 원문 이력서 페이지로 정확히 이동하는지 확인.
- 연결 코드 없이/틀린 코드로 확장에서 API 호출 시 거부되는지 확인.

## 다음 단계 후보 (미확정)

이번 슬라이스 이후: (a) 리스트 후보에도 Level1 정도는 적용해볼지(경력공백 등 리스트에 없는 항목은 "정보없음"으로 남기고), (b) 여러 페이지 자동 순회를 조심스럽게 허용할지, (c) 중복 후보 처리, (d) 다른 플랫폼 확장 — 전부 사용자와 다시 논의 후 결정.
