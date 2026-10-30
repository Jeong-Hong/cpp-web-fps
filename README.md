# CROSSYARD

**C++ → WebAssembly**로 실행되는 최대 4인 로우폴리 웹 FPS입니다.
게임 로직·충돌·맵·카메라·모델 배치는 C++이며, 브라우저 GPU/DOM/WebSocket 연결과 서버의 소켓 전송은 JavaScript가 맡습니다. Three.js·Unity를 쓰지 않습니다.

## 실행 — Windows

이 작업 PC에는 실행용 Wasm을 빌드해 두었습니다. **`START.cmd`를 더블클릭**하거나 다음을 실행합니다. 소스를 새로 복제한 곳에서는 먼저 아래의 빌드를 수행하세요.

```bash
npm ci --ignore-scripts
npm start
```

브라우저에서 **http://127.0.0.1:8088** 을 직접 엽니다. 기본 서버는 이 PC에만 열립니다. 종료는 실행 창에서 `Ctrl+C`입니다.

1. 닉네임을 입력하고 **새 방 만들기**를 누릅니다.
2. **클릭하고 플레이**를 누르면 마우스가 잠깁니다. 한 명이어도 맵을 둘러보고 사격할 수 있습니다. 봇은 없습니다.
3. 같은 서버 주소를 연 친구가 6자리 방 코드로 참가하면 함께 교전합니다. 최대 4명, 자유 교전이며 별도 승리 조건은 없습니다.
4. `Esc`로 조작 메뉴, **방 나가기**로 로비에 돌아옵니다.

`localhost`/`127.0.0.1` 주소는 다른 PC에서는 각자 자신의 PC를 가리킵니다. 다른 PC와 연결하려면 같은 내부망의 서버 IPv4에 명시적으로 바인딩해야 합니다. **기본 실행만으로 친구 PC에 공개되는 것은 아닙니다.** 실제 어댑터·네트워크 범위 확인 뒤 `node server/main.mjs --host <확인된 내부망 IPv4> --port 8088`로 선택할 수 있습니다. 이번 개발 검증은 별도 물리 기기 연결을 보장하지 않으며, 방화벽 설정을 자동 변경하지 않습니다. `0.0.0.0` 공개 바인딩·포트포워딩·인터넷 배포는 하지 않습니다.

## 조작

| 입력 | 기능 |
|---|---|
| W/A/S/D | 이동 |
| 마우스 | 시점·조준 |
| 왼쪽 버튼 | 소총은 누르는 동안 연사, 권총은 클릭마다 한 발 |
| 오른쪽 버튼 | 정밀 조준(시야각 축소) |
| Shift | 달리기(앉은 상태에서는 적용되지 않음) |
| Space | 점프 |
| C | 앉기 / 서기 전환 |
| 1 / 2 | 소총 / 권총 선택 |
| G | 수류탄 투척 |
| R | 재장전 |
| Esc | 마우스 해제·메뉴 |

체력 100, 소총 탄창 24발(피해 25), 반자동 권총 탄창 12발(피해 34)입니다. 무기를 바꿔도 탄창은 각각 유지됩니다. 수류탄은 부활마다 2개이며 투척 후 2.5초에 폭발합니다. 엄폐물이 폭발 피해를 막고, 자신도 피해를 받을 수 있습니다.

사망 후 2.5초에 부활하며 1.5초 보호가 있습니다. 사격하거나 수류탄을 던지면 자신의 보호는 해제됩니다. 서버는 메뉴를 열어도 계속 진행합니다. 차량·지형 파괴·봇·팀전·음성 채팅은 없습니다. 기본 수치는 [docs/ACTIONS.md](docs/ACTIONS.md)에 모아 두었습니다.

## 렌더링

- 보안 컨텍스트(HTTPS 또는 localhost)와 지원 GPU가 있으면 **WebGPU**를 사용합니다.
- WebGPU가 없거나 초기화되지 않으면 **WebGL2**를 사용합니다. LAN의 일반 HTTP에서도 이 경로로 동작할 수 있습니다.
- 로비 오른쪽 위에 **실제 사용 중인 API**가 표시됩니다. WebGPU 초기화 실패 사유는 해당 배지의 title과 콘솔에 남습니다.
- 실시간 GPU 장치 손실은 조작을 중지하고 복구 안내를 표시합니다. 전역 브라우저 보안 플래그를 변경하지 않습니다.
- PC의 동작 줄이기 설정은 반동·장식 움직임을 줄입니다. 총구 빛·명중·피해·재장전·수류탄 폭발 피드백은 유지합니다.

## 소스에서 다시 빌드

필요 도구: Node.js24+, Python3.10+, Emscripten **6.0.13**. 이 PC의 SDK는 `D:/Tools/emsdk`입니다. 다른 경로에서는 `EMSDK`를 지정합니다. 시스템 PATH나 전역 Git 설정을 바꾸지 않습니다.

공식 SDK 준비 예시(처음 한 번):

```bash
git clone https://github.com/emscripten-core/emsdk.git D:/Tools/emsdk
python D:/Tools/emsdk/emsdk.py install 6.0.13
python D:/Tools/emsdk/emsdk.py activate 6.0.13
```

```bash
npm ci --ignore-scripts
python scripts/build.py
npm start
```

빌드 스크립트는 Python으로 SDK의 `em++.py`를 직접 호출하므로 셸의 `emcc` PATH 활성화가 필요하지 않습니다. 서버 Wasm은 `build/sim.mjs`·`build/sim.wasm`, 브라우저 Wasm은 `web/dist/client.mjs`·`web/dist/client.wasm`에 생성됩니다. 생성물은 Git에서 제외합니다. `BUILD.cmd`도 같은 빌드 명령을 실행합니다.

## 구조

```text
include/arena.hpp       공통 타입·규칙·C++ 인터페이스
core/game.cpp           맵·점프/앉기·충돌·소총/권총·수류탄·부활
core/bridge.cpp         Node에서 쓰는 C ABI·스냅샷 직렬화
client/camera.hpp       카메라·투영 수학
client/main.cpp         브라우저 입력·이동 예측·장면·HUD 피드백
web/gpu.mjs             C++ 버퍼를 GPU API에 연결하는 어댑터
web/app.mjs             DOM·방 입장·WebSocket·효과음 어댑터
web/index.html/style.css 로비·게임 HUD·조작 메뉴
server/                 방·연결·검증·전송·정적 파일 서버
scripts/build.py        두 C++ 타깃과 Wasm 테스트 빌드
scripts/live-smoke.mjs  공개 프로토콜만 쓰는 4인 통합 검증
```

서버가 클라이언트의 명중·피해·위치 주장을 받지 않고, 공유 C++ 시뮬레이션을 실행해 결과를 보냅니다. 클라이언트는 같은 충돌 함수로 이동을 예측하고 서버 위치로 보정하며 상대 위치는 보간합니다. 되감기 지연 보상은 없습니다. WebSocket/TCP 기반 소규모 실험용이며 상용 안티치트나 공인 인터넷 보안 감사를 대체하지 않습니다.

## 검증 명령

```bash
npm test
python scripts/build.py --client-test
npm run build
npm run test:e2e
# 서버를 실행한 상태에서 실제 4개 소켓으로 전투·부활·재장전·정리 확인
node scripts/live-smoke.mjs --url http://127.0.0.1:8088
```

GPU 스모크는 합성 정육면체를 그리는 별도 렌더러 테스트이며 게임 플레이 결과가 아닙니다. 서버의 테스트 대역 검사, 실제 C++ Wasm 검사, 실제 소켓 참가자, 독립 브라우저 컨텍스트, 별도 물리 기기는 서로 다른 증거로 구분합니다. 실행한 결과와 남은 경계는 [docs/VERIFICATION.md](docs/VERIFICATION.md)에 정리합니다.

방·이름·전적은 메모리에만 있고 서버 종료 시 사라집니다. 방 코드는 초대 수단일 뿐 계정 인증이나 비밀번호가 아닙니다. 민감한 이름을 쓰지 마세요. 외부 폰트·모델·이미지·분석 서비스는 없습니다. ws(MIT), Playwright(Apache-2.0), Emscripten(MIT 등)의 라이선스는 각 배포본을 따릅니다.
