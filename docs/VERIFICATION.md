# CROSSYARD — 현재 로컬 검증

## v2 이동·무장 확장 — 실행 완료, 독립 검토 진행 중

- 대상 코드: `6f4e21867a4f2f1be777ea689d7df60925a641e3`.
- 이전 완료 기준: `b7b0c69c9ae61ee3e4fcafe000314178d4a9db0b`. 아래 v0.1 기록은 당시 결과이며 새 기능의 증거로 대체하지 않는다.
- 실행 주소: **http://127.0.0.1:8088**. 루프백 리스너와 C++/Wasm health를 확인했다. 기본 실행은 다른 PC에 공개되지 않는다.
- 환경: Windows · Node.js24.21.0 · Python3.14.7 · Emscripten6.0.13.
- 네 기능은 구현·실행했으며 전체 회귀 검사가 통과했다. **독립 검토와 최종 증거 보관은 아직 진행 중**이므로 이 상태를 최종 완료 판정으로 읽지 않는다.

### 재현 명령과 실제 결과

주 명령은 `python scripts/verify.py`이며 [현재 실행 기록](evidence/20261030T104003Z/receipt.json)에 실제 명령 배열·시각·작업 폴더·종료 코드·입력/출력 지문이 있다. 실행 시작 시 소스 트리는 깨끗했고 실행 중 입력 집합은 변하지 않았다.

| 검사 | 실제 명령 | 관찰 결과 | exit |
|---|---|---|---|
| 서버·브라우저 Wasm | `python scripts/build.py` | 실제 두 타깃 빌드, C++ 경고를 오류로 처리 | 0 |
| 공통 C++ 규칙 | `python scripts/build.py --test` | 2,503개 assertion 통과 | 0 |
| C++ 카메라 | `python scripts/build.py --client-test` | 6개 assertion 통과 | 0 |
| Node·전송·기하 | `node --test tests/*.test.mjs` | 114개 통과, 실패·취소·skip 없음 | 0 |
| GPU·Wasm·로비 | `node node_modules/@playwright/test/cli.js test` | 10개 통과 | 0 |
| 실제 게임 | `node node_modules/@playwright/test/cli.js test -c playwright.game.config.mjs` | 17개 통과 | 0 |
| 실제 4소켓 전투 | `node scripts/live-smoke.mjs --url http://127.0.0.1:8088` | 참가·교전·사망·부활·장전·이동·정리 통과 | 0 |
| Windows 실행기 | `python scripts/launcher-smoke.py` | 실제 START.cmd 시작·health·소유 프로세스 정리 | 0 |
| 소스 공백 | `git diff --check` | 오류 없음 | 0 |

브라우저 합계는 27개이며 C++ assertion 수와 합산하지 않는다. Node 격리 검사만으로 실제 게임을 입증한 것이 아니라, 실제 생성 모듈·소켓·GPU·브라우저를 따로 실행했다. 정적 타입 검사·전용 린터·원격 CI·새 복제 설치를 이번 확장에서 실행했다는 뜻은 아니다.

### 새 기능을 실제로 확인한 경로

- **점프:** 실제 Space 입력 → 서버 Y 상승·접지 해제 → 착지. 키를 계속 눌러도 두 번째 점프가 발생하지 않으며 실제 렌더 시점도 올라간다.
- **앉기:** 실제 C 전환 → 서버의 crouch → 낮아진 시점·자세 HUD·상대 모델 높이. 상대는 일반 소켓 입력으로 이동시켰으며 내부 좌표를 바꾸지 않았다.
- **권총:** 2 선택·독립 탄창·누른 채 유지해도 한 발·짧은 추가 클릭·1/2 전환 시 탄약 유지·R 장전·Esc 뒤 선택 유지. 효과 줄이기 두 설정과 강제 WebGL2에서 실제 총구 빛을 캡처했다.
- **수류탄:** G 한 번·잔량 감소·비행·폭발·자해·잔량 0 거부·탈퇴 시 투사체 제거. 브라우저 1개와 일반 소켓 상대 3개가 같은 서버 시각의 전체 플레이어/수류탄 상태를 받는 것을 비교했다. 세 렌더 조건에서 자해 후 HP39가 관찰됐으며 사람 4명이나 제품의 봇을 뜻하지 않는다.
- **화면:** 실제 로비·메뉴·활성 HUD의 1440/768/375px, 로딩·연결 끊김과 복귀. 앉은 상태의 권총 HUD에서 패널 분리·한국어 14px 이상·가로 넘침 없음을 검사했다.
- **원본 이미지:** [이번 실행의 PNG 51개](evidence/20261030T104003Z/captures/). 사격·수류탄 비행/폭발 이미지 일부는 canvas-only이며 HUD나 OS 커서 증거가 아니다. 최종 시각 판정은 독립 검토 완료 뒤 별도로 기록한다.

### 실제 안내 주소 재검사

[기본 주소 관찰](evidence/20261030T104003Z/primary-origin/observation.json)과 [실제 플레이 캡처](evidence/20261030T104003Z/primary-origin/actions-player.png)를 추가로 보관했다. 브라우저 자동화의 처음 연결이 about:blank로 돌아간 관찰은 성공으로 세지 않고, 정확한 주소 복원·브라우저 탭의 visible 확인 후 처음부터 다시 수행했다.

`http://127.0.0.1:8088`에서 실제 새 방 → 클릭·포인터 잠금 → Space → C → 2 → 마우스 클릭 → G → Esc → 나가기를 실행했다. 서버 상태는 점프 관찰, 앉음, 권총 11발, 수류탄 1개를 보였고 HUD와 일치했다. API는 WebGPU, 효과 줄이기는 켜짐이었다. 자동화 입력이며 사용자 기존 탭이나 물리 손 입력을 관찰한 것은 아니다. 만든 방은 정상 퇴장으로 정리했다.

### 발견한 문제와 수정 근거

| 문제 | 재현과 수정 |
|---|---|
| 짧은 권총 클릭 유실 | 30Hz 출력에서 두 번째 true가 빠지고 서버 shot1/ammo11이 유지되는 것을 기록. 권총 누름/뗌 에지를 즉시 전송해 같은 검사에서 두 번째 사격과 ammo10을 확인했다. 테스트에 클릭 지연을 넣지 않았다. |
| 눈 위치에 생성된 수류탄의 근접 클리핑 | 실제 비행 캡처와 렌더 인스턴스로 카메라를 감싸는 첫 프레임을 재현. 판정상의 투척 원점은 유지하고 카메라 바로 앞 비행 메시만 제외했다. 같은 검사와 새 이미지로 재확인했다. |
| 사망/부활 문구 모호함 | 기존 시체 좌표 유지 동작을 보존하고 부활 시 위치·자세·자원을 초기화한다는 뜻으로 계약을 명확히 했다. 기존 사망 좌표 거부 검사는 유지했다. |

[TDD 원본 색인](evidence/20261030T104003Z/archive-index.json)에 공통 로직·서버·클라이언트의 실제 명령과 원본 stdout/stderr 보관 경로·지문을 연결했다. RED·의도한 mutation 실패와 예상 밖의 과거 실패를 구별하며, 실패 기록을 뒤의 성공으로 덮어쓰지 않았다. 과거 TDD 지문을 현재 코드의 실행 결과로 바꿔 쓰지 않는다.

### 확장 요구·작업·증거 대응

원문에 ID가 없어 기존 FR-001~005, SC-001~008 다음 번호를 이어 붙였다. 동작 이름에 따른 대응이며 실행 성공률을 뜻하지 않는다.

| ID | ACTIONS의 요구 | 작업 | 해당 회귀·증거 |
|---|---|---|---|
| FR-006 | 실제 점프·앉기·공유 충돌 | actions-core, actions-client | C++ 규칙·Space/C 브라우저 검사 |
| FR-007 | 권총·독립 자원·반자동 | actions-core, actions-client | C++ 쿨다운/에지·Digit2 3조건 |
| FR-008 | 수류탄·차폐·자해·수명주기 | actions-core, actions-client | C++ 투사체/폭발·G 4자 동일 상태 |
| FR-009 | strict v2·ABI·서버 권위 | actions-contract, actions-server | protocol/engine/실제 Wasm 소켓·전체 Node |
| SC-009 | HUD·모델·효과·3폭 | actions-client, actions-verify | 실제 뷰포트·사격/폭발 캡처 |
| SC-010 | 전체 회귀·리뷰·보관·실행 안내 | actions-verify, actions-deliver | 현재 receipt·독립 검토 진행 중·이 문서 |

대응표는 기능 요구 4개·성공 기준 2개와 작업 6개를 연결한다. 작업 대응은 100%이며 대응 작업이 없는 요구·요구와 연결되지 않은 작업은 없다. 독립 검토가 남은 SC-010은 아직 실행 완료로 판정하지 않는다.

### 현재 남은 경계

독립 코드/화면 검토와 그 결과의 보관은 진행 중이다. 실제 별도 PC의 LAN·방화벽·공유기·모바일 터치·다른 브라우저 엔진·사용자 물리 입력은 미검증이다. 자동 WebGPU 초기화 실패/장치 손실 복구를 새로 유발하지 않았다. 계정·상용 안티치트·되감기 지연 보상·인터넷 공개 서비스는 구현 범위 밖이다. 원격 push·CI·배포는 실행하지 않았다.

---

# v0.1 기본 FPS의 과거 검증 기록

아래 숫자와 판정은 이동·무장 확장 이전 기록이다. 현재 v2 결과는 위 절을 따른다.


## 범위와 판정

- 프로젝트: `D:/Projects/Vibe_Coding/cpp-web-fps`.
- 실제 최종 실행 코드: `329881a9158814f5113db50dabe5f2c95c74a43f`.
- 환경: Windows x64 · Node.js24.21.0 · Python3.14.7 · Emscripten6.0.13.
- **승인된 로컬 시제품 범위 통과.** 소스는 커밋되어 있으며 당시 미추적 검증 자료는 receipt의 `initial_git_state`에 구분했다. 이후 문서 커밋을 실제 실행 리비전으로 바꿔 쓰지 않는다.
- 인터넷 배포·별도 물리 기기·사용자 기존 탭/프로필의 손 입력까지 검증한 것은 아니다.

## 명령·관찰 결과

주 실행은 `python scripts/verify.py`다. [최종 receipt](evidence/20261030T084415Z/receipt.json)에 실제 실행 배열·작업 폴더·시각·종료 코드·원시 stdout/stderr 지문을 보존했다.

| 검사 | 명령 | 결과 | exit |
|---|---|---|---|
| Wasm 빌드 | `python scripts/build.py` | 서버/브라우저 생성, C++ 경고를 오류로 처리 | 0 |
| C++ 게임 규칙 | `python scripts/build.py --test` | **948개 검사 통과** | 0 |
| C++ 카메라 | `python scripts/build.py --client-test` | **6개 검사 통과** | 0 |
| 서버·전송·기하 | `node --test tests/*.test.mjs` | **84개 통과**, 실패/취소/skip 0 | 0 |
| GPU·Wasm·로비 | `node node_modules/@playwright/test/cli.js test` | **8개 통과** | 0 |
| 실제 게임 E2E | `node node_modules/@playwright/test/cli.js test -c playwright.game.config.mjs` | **9개 통과** | 0 |
| 실제 4소켓 전투 | `node scripts/live-smoke.mjs --url http://127.0.0.1:8088` | 교전·사망·부활·재장전·정리·5번째 거부 | 0 |
| Windows 실행기 | `python scripts/launcher-smoke.py` | 실제 START.cmd 서버·health·소유 프로세스/리스너 정리 | 0 |
| 공백 | `git diff --check` | 오류 없음 | 0 |

브라우저 검사는 **17개**다. C++ assertion 수와 Node/Playwright 테스트 수를 하나로 합산하지 않는다. JavaScript/Python 구문 검사는 별도로 확인하며, 정적 타입 검사·ESLint·Stylelint·원격 CI까지 통과했다는 뜻은 아니다.

### 실제 안내 주소의 조작 재검사

격리된 E2E 서버 결과와 기본 실행 주소를 구별했다. [기본 주소 재검사](evidence/20261030T084415Z/primary-origin/receipt.json)는 `http://127.0.0.1:8088`의 실제 서버에서 다음을 실행했다.

`node node_modules/@playwright/test/cli.js test -c .omh/artifacts/direct.config.mjs --grep "actual C"`

`reduce`·`no-preference`·`reduce/WebGL2`의 같은 조작 시나리오 **3개 재검사 통과, exit 0**. 실제 클릭·포인터 잠금·이동·조준·서버 탄약·재장전·Esc·퇴장을 확인했다. 실행 설정·stdout/stderr·캡처를 함께 보관했다. 새 headless Chromium 컨텍스트이며, 사용자 기존 프로필이나 물리 손 입력을 관찰한 것은 아니다. 이 반복을 17개와 합쳐 서로 다른 20개 검사라고 부르지 않는다.

## 통합·시각 증거

- [4소켓 원시 결과](evidence/20261030T084415Z/live.stdout.txt)는 일반 프로토콜만 사용한다. 자동화 4자의 서로 다른 ID, 5번째 `ROOM_FULL`, 실제 스폰 간 4회 명중·1킬과 모든 참가자의 같은 사망 상태, 부활·재장전·이동·퇴장·빈 방 정리를 확인했다. 사람 4명이나 제품의 봇이 아니다.
- 독립 브라우저 4개의 방 인원/ID와 5번째 만석 안내를 확인했다. 4자 전투 수명주기 일치는 위 소켓 검사로 별도 구분했다.
- 실제 브라우저/소켓 상대의 교전으로 명중·킬·HP75 피격과 피해 표시를 확인했다. 처치 문구는 350ms 뒤 유지와 이후 만료를 검사했다.
- 없는 방 재시도, 소유 검사 서버의 종료/재시작 뒤 복귀, 로딩 중 중복 동작 차단을 검사했다.
- 로비·메뉴의 1440/768/375px, 로딩/연결 끊김 상태, 375px 하단 PC 안내를 검사했다. **모바일 터치 플레이는 미검증**이다.
- 합성 정육면체 GPU 검사와 실제 C++ 게임을 구별한다. WebGPU와 강제 WebGL2를 실행했지만 자동 초기화 실패/장치 손실·복구까지 유발하지는 않았다.
- [최종 원본 PNG 31개](evidence/20261030T084415Z/captures/)의 지문·픽셀 크기·보관 경로는 receipt에 있다. `firing-*`는 HUD/OS 커서 없는 canvas-only 이미지다. 주요 로비·메뉴·사격·명중·피격·처치의 실제 이미지를 확인했다. 시각 판정은 [visual-final.json](evidence/visual-final.json)과 별도 범위 기록을 따른다.
- 실행 주소의 HTML/CSS/JS/브라우저 Wasm 6개 자산은 로컬 바이트와 일치했다. 로컬 LCP 표본은 진단용이며 현장 p75·다른 기기 성능·60fps 보장이 아니다.

## 발견·수정·리뷰

초기 독립 리뷰는 초기 커밋 `25e8b80d54abbc77626fec23a2095d11b228fbaa`부터 `7c392b2d262a1360348478af778f370602be01e2`까지 전체 구현을 읽었다. [완료 메타데이터와 원본 trace](evidence/review-initial/)를 보관했다.

| 항목 | 수정과 재검증 |
|---|---|
| P2: 최초 seq0 무시 | 수신 여부와 ack를 구분. 실제 이동·중복/과거 순서·재입장 초기화를 C++와 실제 Wasm 소켓으로 RED→GREEN |
| P3: 처치 문구가 다음 프레임에 사라짐 | 만료 시각을 유지. 실제 교전 뒤 350ms 유지·이후 만료를 같은 브라우저 검사로 RED→GREEN |
| 추가 재장전 누락 | 실패 trace의 seq22 reload=true, seq23=false, ack23/reload0을 확인. 판정 전 덮어쓰기 경로를 C++/소켓에서 재현하고 다음 tick까지 보존·일회 소비하도록 수정 |
| 768px 포함 경계 | 767px CSS 한계를 계약의 768px로 수정. 실제 영역 좌표의 RED→GREEN과 새 캡처로 확인 |

[수정별 원시 실행 기록](evidence/review-fixes/)에 명령·exit·소스 지문·로그가 있다. RED는 목표 assertion 실패였으며 SDK·구문 오류를 RED로 세지 않았다.

[후속 독립 리뷰](evidence/review-final.json)는 세 게임 수정의 동결 코드 `79e20a50d72af0a46924c2f9ed3252c16eea5e57`을 검토해 **로컬 시제품 기준 ship, 미해결 findings 없음**으로 판정했다. 해당 일곱 파일은 최종 실행 코드와 바이트가 같다. 뒤의 CSS 경계는 부모가 별도로 수정·검증했으며, 이 리뷰가 후속 CSS나 새 전체 테스트·시각 QA를 실행했다고 주장하지 않는다.

## 새 복제본

[최종 clean-install](evidence/20261030T084415Z/clean-install.json): 같은 코드의 `git clone --no-hardlinks` → `npm ci --ignore-scripts --no-audit --no-fund` → 실제 빌드 → `npm test` → 카메라 검사, 모두 exit0. 실제 기록은 Windows npm CLI를 Node로 호출했다.

입력 **42개 파일**, 생성 `.mjs`/`.wasm` 4개, 정적 HTML/CSS/JS·잠금 파일이 원래 실행과 바이트 단위로 같았다. 원인 모를 JS/CSS 차이를 정규화하지 않았다. 복제본 소스 트리는 깨끗했으며 복제본에서 브라우저 E2E를 다시 실행한 것은 아니다. `npm audit --audit-level=high --json`은 알려진 취약점 합계0/exit0이었다. 앱 전체 보안 감사는 아니다.

임시 복제본은 삭제 확인을 위해 남겼다. 모두 `D:/Tools/Hermes/profiles/omh/cache/scratch/` 아래다.

- `cpp-web-fps-clean-20261030T080600Z`
- `cpp-web-fps-clean-20261030T083508Z`
- `cpp-web-fps-clean-20261030T084415Z`
- 문서 복사 중간 파일: `crossyard-verification-final.md`

프로젝트 소스·SDK·회귀 검사·보관 증거는 이 임시 자료 삭제 범위가 아니다.

## 요구·작업·증거 대응

원문에 ID가 없어 문서 순서로 부여했다. 이름/동작 기준 매핑이며 원문에 ID가 있었던 것은 아니다.

| ID | PLAN의 의미 | 작업 | 증거 |
|---|---|---|---|
| FR-001 | 별도 새 프로젝트 | setup | 초기 Git/변경 경로 |
| FR-002 | 도구·Git·실행 검증 | setup, verify, deliver | 빌드/실행기/복제 설치/Git |
| FR-003 | C++ Wasm와 플랫폼 경계 | core, client, server | 컴파일/export/GPU/통합 |
| FR-004 | 이동·조준·전투·4인 | core, client, server, verify | 948 검사/브라우저/4소켓 |
| FR-005 | 배포·push·방화벽 제외 | setup, server, deliver | 루프백/CLI/원격 미실행 |
| SC-001 | Wasm 로드·맵 | client, verify | 빌드/client-contract/E2E |
| SC-002 | 클릭·이동·조준·탄약·R·Esc | client, verify | 3조건 조작/기본 주소 재검사 |
| SC-003 | 독립 4자 일치 | server, verify | 소켓 전투/브라우저 입장 |
| SC-004 | 입력·벽·속도·정리 | core, server, verify | C++/거부 사례/live |
| SC-005 | 느린 수신자 격리 | server, verify | queue/timeout/tick 회귀 |
| SC-006 | 1440/768/375 화면 | client, verify | viewport/포함 경계/PNG |
| SC-007 | 물리 LAN 미검증 구분 | deliver | README/이 기록 |
| SC-008 | 안내·지문·제한 | deliver | README/원시 기록/이 문서 |

FR5개·SC8개, 대응 작업6개, 미대응 작업0개, 작업 매핑100%, 작업 없는 요구0개·증거 항목 없는 매핑0개다. 문서의 대응 관계이지 실행 성공률이나 독립 리뷰 통과율은 아니다. 발견한 구현 불일치는 위 수정/재검사에 따로 남겼다.

## 보관·미검증 경계

- 원시 출력의 줄바꿈·빈 줄을 고치지 않는다. 증거 폴더에만 Git 바이트 보존/CRLF 속성을 적용하고 인덱스·커밋 blob과 원본을 대조한다. 문서 커밋 후에는 최종 입력 집합·지문·생성물·서빙 자산·리스너·health를 다시 확인한다.
- 최종 실행기의 중첩 stdout에는 Windows 이중 CR, HUD RED의 Playwright 출력에는 줄 끝 공백이 실제로 있다. 두 원본 파일에만 추가 공백 예외를 적용했으며 바이트는 수정하지 않았다. 소스의 공백 검사는 유지한다.
- 이전 성공과 `20261030T082733Z`의 실패도 원래 코드·시각·실패 상태 그대로 보존했다. 실패 trace를 뒤의 성공으로 덮지 않았다.
- 생성물은 Git 제외, `scripts/build.py`로 재생성한다. 별도 정식 생성물 맵은 없으며(`map_not_declared`) 실제 출력 지문과 재빌드 대조를 구분한다.
- 다른 PC의 LAN/공유기/방화벽/AP 격리·기기 GPU/브라우저는 미검증이다. 기본 루프백은 다른 PC에서 접속할 수 없다.
- 터치·스크린리더 전체 플레이·기존 사용자 프로필의 물리 손 입력, 자동 GPU fallback/장치 복구는 미검증이다.
- 4인 시제품이다. BattleBit 이식·254인 전투·차량·대규모 파괴·봇·팀전·음성·상용 안티치트·계정 인증·되감기 지연 보상·인터넷 보안 검증은 없다.
- 방·이름·전적은 메모리 안에만 있으며 서버 종료 시 사라진다. CI·원격 push·태그·공개 배포는 실행하지 않았다.

## 보관 ID

체크리스트에는 경로 대신 아래 짧은 ID를 사용한다. 저장된 선언은 실행 증거가 아니며 원본 파일을 확인해야 한다.

| ID | 실제 대상 |
|---|---|
| `20261030T084415Z` | `docs/evidence/20261030T084415Z/receipt.json` 및 같은 폴더의 원시 로그·복제 설치·기본 주소 재검사 |
| `crossyard-final-provenance` | `docs/evidence/final-provenance.json` — 문서 커밋 후 입력 집합·생성물·Git 보관 바이트·실행 주소 재확인 |
| `crossyard-independent-followup` | `docs/evidence/review-final.json` |
| `crossyard-final-visual` | `docs/evidence/visual-final.json` 및 `visual-final-scope.json` |
