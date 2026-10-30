# CROSSYARD design system

## 0. Research Log
- Emscripten 공식 설치·EM_JS 문서: C++/Wasm과 브라우저 API 연결 경계를 확인했다.
- WebGPU Fundamentals vertex-buffers: 인스턴스 버퍼와 정점 셰이더 구조를 참고한다. 예제 이미지·브랜드 자산은 복사하지 않는다.
- OMH taste-foundations / design-system-contract: 시각 계층·CJK 14px·입력 상태 규칙을 적용한다.
- OMH 로컬 `design data` palette/font/ux(dev-tool)를 실제 조회했다. 어두운 면의 단계 구분, 한국어 14px 하한, 실패 원인과 다음 행동을 함께 쓰는 규칙을 취했다. 게임은 도구 대시보드와 다르므로 예시 파랑·보라 팔레트와 모노스페이스 본문은 채택하지 않았다.

## 1. Atmosphere & Identity
- 방향: **Bold / expressive**, 산업 현장 사격장. 단단함·명료함·현장감.
- 이름 CROSSYARD. 넓게 깔린 실시간 로우폴리 항만 야드, 큰 압축형 워드마크, 산성 노랑의 얇은 안전표식이 서명 요소다.
- 관객: PC 키보드·마우스로 함께 들어오는 소규모 참가자. 장식형 대시보드·크림 편집 디자인·유리 카드는 쓰지 않는다.

## 2. Color
- `--surface:#111919`, `--surface-foreground:#f4f1e7`.
- `--panel:#1c2828`, `--panel-foreground:#f4f1e7`, `--raised:#263535`, `--raised-foreground:#f4f1e7`.
- `--muted:#bac7bf`, `--border:#4c615c`.
- `--accent:#e9ff70`, `--accent-foreground:#111919`, `--ring:#9de8ed`.
- `--danger:#fa8657`, `--danger-foreground:#111919`. 적·피해는 주황, 방 코드·주요 동작은 노랑. 색 외에 문구·숫자·아이콘도 사용한다.
- 80% 중성·야드, 15% 정보 계층, 5% 강조. 본문 텍스트 대비 WCAG AA 4.5:1 목표. 반투명 HUD에는 어두운 실면 패널을 둔다.

## 3. Typography
- 표시: `Impact, 'Arial Black', sans-serif`. 정보 본문: `'Segoe UI', 'Malgun Gothic', sans-serif`.
- scale 14/16/20/28/48/80; 본문 16px, 한국어 안내 최소14px. 행간 본문1.6, 표시0.95. 표시만 대문자/좁은 자간.
- 한국어는 keep-all, 과도한 자간 없음. 방 코드와 숫자는 tabular-nums. 외부 폰트 요청 없음.

## 4. Spacing & Layout
- 기본4px, 8/12/16/24/32/48/64. 모서리는 공통 `--radius:2px`.
- canvas는 viewport 전체. 로비는 하단까지 스크롤 가능한 전면 레이어, 데스크톱은 제목과 참가 패널의 비대칭 2열.
- 768 이하 1열, 375 이하도 가로 넘침 없이 세로 스크롤. 터치 화면에는 PC 조작 필요 안내. 플레이 중에는 문서 스크롤 없음.
- 게임 HUD: 좌상단 방 정보, 우상단 참가자, 중앙 조준점, 좌하단 HP, 우하단 탄약. 메뉴는 중앙 실면 패널.

## 5. Components
- primary button: accent pair, 최소44px 높이, hover 밝기/테두리, focus-visible 3px ring, active 1px 이동, disabled 불투명도0.45, loading 중 문구 교체·중복 실행 금지.
- secondary button: raised pair, border. 입력은 surface pair, label 필수, 오류는 고정된 한국어 안내·role=status. 방 없음·만석·연결 끊김은 별도 문구.
- participants: 실제 이름·킬·사망만 표시. 더미 접속자나 가짜 ping 없음.
- menu: 입장 후 클릭 활성화, Esc 후 복귀, 마우스 감도·효과 줄이기·음소거·나가기. 닫기 뒤 canvas로 포커스.

## 6. Motion & Interaction
- DOM 피드백120ms ease-out. 로비 장면은 reduce 환경에서 정지. 게임 카메라는 직접 입력에만 반응.
- reduce는 반동·장식 흔들림을 줄이되 총구 빛·명중 표시·피해·재장전 상태는 유지한다.
- 포인터 잠금은 실제 사용자 클릭으로 요청한다. Esc/blur/숨겨짐/연결 해제는 held input을 지우고 잠금을 해제한다. 전투 서버는 메뉴와 무관하게 계속 돈다.
- 서버 상태로 내 조준을 덮어쓰지 않는다. 오른쪽 버튼은 ADS, contextmenu 비활성은 canvas에만 적용한다.

## 7. Depth & Surface
- 메뉴는 실면 배경과 1px 테두리. 무차별 그림자·backdrop blur 없음. 맵 이름 안내는 밝은 3D 배경에서도 읽히도록 surface 토큰의 작은 실면 위에 표시한다.
- 로비 가독성용 어두운 좌→우 스크림은 장면과 텍스트 분리 목적. 3D는 방향성 명암·거리 안개·낮은 폴리곤 실루엣으로 계층을 만든다.

## 8. Accessibility Constraints & Accepted Debt
- 로비·메뉴는 native inputs/buttons, 논리적 Tab 순서, 이름 있는 조작과 visible focus.
- 명중·피해를 색이나 소리에만 의존하지 않는다. Esc 사용 안내 항상 제공.
- FPS 본체는 키보드·마우스·시각 기반이며 스크린리더 전체 플레이와 터치 조작은 제공하지 않는다. 메뉴·안내는 접근 가능하게 한다.
- 성능 예산: 로컬 PC Chrome, 1440x900, 무제한 로컬 네트워크의 새 방문에서 LCP 2.5초 목표(측정 전 예산). 60fps는 목표일 뿐 보장하지 않는다. 실사용 p75나 다른 기기 성능은 주장하지 않는다.
