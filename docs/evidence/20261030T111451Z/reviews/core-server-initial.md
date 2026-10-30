# 공통 로직·서버 읽기 전용 리뷰

- 저장소: D:/Projects/Vibe_Coding/cpp-web-fps
- 기준: b7b0c69c9ae61ee3e4fcafe000314178d4a9db0b
- 대상: e14156616acafc3bdf0b1f02c59fbb6cca310194
- 계약: docs/ACTIONS.md, docs/PROTOCOL.md
- 범위: include/arena.hpp, core/game.cpp, core/bridge.cpp, server/protocol.mjs, server/engine.mjs 및 관련 core/engine/protocol/transport 테스트.
- 검토 소스는 종료 직전에도 대상 커밋과 일치(EOL 정규화 비교). 소스 수정·빌드·커밋을 수행하지 않았다.

## 결함

### P2 — 입력 만료가 권총의 가짜 재클릭을 만든다

- 신뢰도: 높음(실제 Wasm 직접 호출 및 공개 WebSocket 경로에서 재현).
- 경로/행: core/game.cpp:104, 245-247. 새 semi_pending 계산이 만료 처리로 false가 된 player.input.fire를 이전 물리 버튼 상태로 재사용한다.
- 계약: docs/ACTIONS.md:22-23 및 docs/PROTOCOL.md:23. 권총은 새 press edge에서만 발사하며 누른 채 유지한 상태가 재발사나 무기 전환에 의한 가짜 press가 되어서는 안 된다.
- 재현: 권총 장착 완료 → seq1 fire:true로 첫 발 → 새 입력 없이 24회의 1/60초 tick → fire:false를 한 번도 보내지 않고 seq2 fire:true → 다음 tick에 추가 발사.
- 관측: shot 1→2, pistolAmmo 11→10. input 만료 250ms가 서버 내부에서 fire를 false로 바꾸므로, 네트워크 지연 뒤 같은 held:true가 새 클릭으로 인정된다.
- 공개 소켓 재현: 독립적인 127.0.0.1:49429 서버, 두 소켓 사용. 첫 shot=1/ammo=11, 이후 release 없는 held:true에서 shot=2/ammo=10. 관찰자의 전체 state도 동일. 종료 후 owned listener closed=true.
- 테스트 빈틈: tests/core_tests.cpp:390-400은 연속 갱신되는 held fire와 중복 seq만 확인한다. 만료 후 true 재개 조합이 빠져 있다.
- 수정 방향(미구현): 만료 가능한 실행용 held fire와 마지막 유효 입력의 버튼 상태를 분리하고, 만료 자체가 press edge를 생성하지 않도록 회귀 검증한다.

## 계약 판정 및 ship 판단

- 정확한 v2 입력 필드·타입·범위, 누락/스푸핑 거절, ABI 순서 및 필수 v2 export: 검토와 실행에서 문제를 찾지 못함.
- 이동/실제 stance, 장착·별도 탄창·재장전, 수류탄 자원·타이머·충돌·가림·실드·죽음/leave 정리: 기존 실제 Wasm core 검사 통과. 일반적인 v2 이동/stance/throw의 소켓 전달과 두 관찰자 합의도 별도 확인.
- 권총의 stale-resume press 규칙: 미충족.
- verdict: no_ship, confidence: 높음. REVIEW.md가 없어 ‘명시적 기능 계약이 실제 공개 입력 경로에서 재현 가능하게 깨지면 보류’를 이번 차단 기준으로 사용했다. P2는 영향의 우선순위이며, 전체 계약 충족을 뜻하지 않는다.

## 실행 근거

환경: Node v24.21.0, 기존 Emscripten 산출물 사용. 모든 명령 종료코드 0(아래 명시한 최초 추가 probe 오류 제외).

1. node build/core-tests.cjs → PASS 2503 C++ checks.
2. node --test --test-reporter=tap tests/engine-server.test.mjs tests/protocol-server.test.mjs → 23/23 PASS.
3. node --test --test-reporter=tap --test-name-pattern='^(?!static root)' tests/transport-server.test.mjs → 실제 실행 결과 78/78 PASS, skipped 0. 필터는 static fixture를 제외하지 못했으며 해당 Node 테스트의 scratch fixture 생성·자체 삭제도 실행되었다. 소스 파일 쓰기는 없었다.
4. 추가 in-memory 실제 Wasm probe → release 없는 stale-resume 권총 재발사 확인.
5. 추가 실제 WebSocket probe → 127.0.0.1:49429, coalesced jump/grenade가 false snapshot을 넘어 한 번 실행됨, y=0.3700000047683716, crouch=true, weapon=1, grenadeCount=1, grenades=1, observerAgreement=true. 같은 공개 입력 경로로 권총 결함 재현. 소유 listener 종료 확인.
6. git diff --check (지정 범위의 기준..대상) → 정상.

최초 추가 소켓 probe는 join 직후 기존 관찰자에게 즉시 state가 온다고 잘못 가정하여 timeout(exit 1). 해당 소유 서버는 finally에서 닫았고, clock tick 후 state를 기다리도록 probe만 고쳐 재실행했으며 위 5번이 그 성공 결과다. 제품 결함으로 분류하지 않았다.

## 미검증 및 상태 경계

- 빌드 금지에 따라 clean rebuild, 소스→Wasm 빌드 재현성은 미검증. 아래 해시는 실행한 기존 산출물을 식별할 뿐 재현 빌드를 증명하지 않는다.
- client/main.cpp·web/app.mjs의 실제 키 edge 생성, 브라우저 prediction/rendering/HUD, E2E, GPU, 실제 장치/LAN은 범위 밖.
- 8088 사용자 서버와 외부 네트워크에 접속하거나 이를 중지하지 않았다. 추가 검증은 루프백 임시 포트만 사용했다.
- 검토 시작 시 작업 트리는 깨끗했으나 종료 시 범위 밖 client/main.cpp, tests/e2e/game.spec.mjs, web/app.mjs에 동시 변경이 관측되었다. 이 리뷰에서는 해당 파일에 쓰지 않았다. 검토 범위 파일 및 실행 build 해시는 그대로였다.
- 독립적인 추가 reviewer의 재검증은 이 결과에 포함하지 않는다.
- 생성한 지속 파일은 이 scratch 보고서뿐이며 저장소 소스·빌드·Git 변경은 없다. Node transport 테스트가 자체 관리한 임시 fixture는 별도다.

## SHA-256

- build/core-tests.cjs: 6940f85e8ae4e86f1b52f1cfaec10a0567d6a779277d1ac59787b6793e29c188
- build/core-tests.wasm: a9a77537eeef29b6aaf5cb6f011b02d6172d7d860eee32a1aa07f8bb8bad03a7
- build/sim.mjs: 629fc99736c1d517e531ed47125fa27854461897da0dc8344fa34be6985c5f25
- build/sim.wasm: 41e680cfd335059b99b488898239a0f8fc14563ab8bf42a231be99d12936fcd3
- 검토 소스 번들: bde77dc45660867305d12c0e69d519347433a93dbdd7d59bfb08ed1a516d0ba5

소스 번들 정의: docs/ACTIONS.md, docs/PROTOCOL.md, include/arena.hpp, core/game.cpp, core/bridge.cpp, server/protocol.mjs, server/engine.mjs, tests/core_tests.cpp, tests/engine-server.test.mjs, tests/protocol-server.test.mjs, tests/transport-server.test.mjs의 경로를 정렬한 뒤, 각 UTF-8 상대경로 + NUL + 작업 파일 원본 바이트 + NUL을 이어 SHA-256 계산.
