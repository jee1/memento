# Anchor Map UI 수동 테스트 가이드

## 테스트 환경 준비

### 1. 서버 실행

```bash
# HTTP 서버 실행
npm run dev:http

# 또는 빌드 후 실행
npm run build
npm run start
```

서버가 정상적으로 시작되면:
- HTTP 서버: `http://localhost:9001`
- WebSocket 서버: `ws://localhost:9001`
- 대시보드: `http://localhost:9001/dashboard`

### 2. 테스트 데이터 준비

앵커 시스템을 테스트하기 위해 먼저 메모리와 앵커를 설정해야 합니다.

#### MCP 클라이언트를 통한 테스트 데이터 생성

```bash
# 1. 메모리 생성
curl -X POST http://localhost:8080/tools/remember \
  -H "Content-Type: application/json" \
  -d '{
    "content": "테스트 메모리 1: 앵커 시스템 테스트용",
    "type": "episodic",
    "importance": 0.7
  }'

# 응답에서 memory_id를 복사 (예: "mem_1762669907827_rxhmdv9mz")
# 2. 앵커 설정 (위에서 복사한 memory_id 사용)
curl -X POST http://localhost:8080/tools/set_anchor \
  -H "Content-Type: application/json" \
  -d '{
    "memory_id": "mem_1762669907827_rxhmdv9mz",
    "slot": "A",
    "agent_id": "default"
  }'

# 3. 추가 메모리 생성 및 앵커 설정 (선택)
curl -X POST http://localhost:8080/tools/remember \
  -H "Content-Type: application/json" \
  -d '{
    "content": "테스트 메모리 2: 관련 메모리",
    "type": "episodic",
    "importance": 0.6
  }'
```

**주의**: `memory_id`는 실제로 생성된 메모리의 ID를 사용해야 합니다. 위 예시의 `"생성된_메모리_ID"`는 실제 ID가 아닙니다.

## 테스트 체크리스트

### 기본 기능 테스트

#### ✅ 6.1-6.2: Static 파일 서빙 및 대시보드 접근

- [x] `http://localhost:9001/dashboard` 접속
- [x] 대시보드가 정상적으로 로드됨
- [x] CSS 스타일이 적용됨
- [x] JavaScript가 정상적으로 실행됨

#### ✅ 6.3-6.4: Anchor Map API

- [ ] 브라우저 개발자 도구에서 Network 탭 열기
- [ ] `http://localhost:9001/api/anchors/map?agent_id=default` 직접 접속
- [ ] JSON 응답이 정상적으로 반환됨
- [ ] `anchors`, `nodes`, `links` 필드가 포함됨

#### ✅ 6.5-6.7: 대시보드 UI 렌더링

- [ ] 헤더가 정상적으로 표시됨
- [ ] 사이드바(Anchors, Memory Details)가 표시됨
- [ ] 맵 컨테이너가 표시됨
- [ ] Legend가 표시됨

#### ✅ 6.8-6.9: D3.js 시각화 및 슬롯별 색상

- [ ] D3.js가 정상적으로 로드됨 (개발자 도구 Console 확인)
- [ ] 앵커 노드가 표시됨
  - [ ] Slot A: 빨간색 (#ef4444)
  - [ ] Slot B: 노란색 (#f59e0b)
  - [ ] Slot C: 파란색 (#3b82f6)
- [ ] 메모리 노드가 회색으로 표시됨

#### ✅ 6.10: Hop 거리에 따른 원형 레이어

- [ ] 앵커를 중심으로 메모리들이 배치됨
- [ ] 1-hop 메모리가 앵커에 가까이 배치됨
- [ ] 2-hop, 3-hop 메모리가 점점 멀리 배치됨

#### ✅ 6.11: 연결선 표시

- [ ] 앵커와 메모리 간 연결선이 표시됨
- [ ] 메모리 간 직접 연결선이 표시됨 (memory_link 기반)
- [ ] 연결선 스타일이 다름 (hop/link 구분)

#### ✅ 6.12: 메모리 상세 정보 표시

- [ ] 앵커 노드 클릭 시 상세 정보 표시
  - [ ] Type: Anchor (Slot X)
  - [ ] Memory ID
  - [ ] Content
  - [ ] Importance
  - [ ] Created
  - [ ] Change Anchor 버튼
- [ ] 메모리 노드 클릭 시 상세 정보 표시
  - [ ] Type: Memory
  - [ ] Memory ID
  - [ ] Content
  - [ ] Hop Distance
  - [ ] Similarity
  - [ ] Importance
  - [ ] Created

#### ✅ 6.13: 앵커 목록 및 선택

- [ ] 사이드바에 앵커 목록이 표시됨
- [ ] 각 앵커 항목 클릭 시 해당 노드로 이동
- [ ] 앵커 항목 색상이 슬롯별로 구분됨

#### ✅ 6.14: 검색 결과 하이라이트

1. **검색 UI 테스트**
   - [ ] 검색 입력 필드가 표시됨
   - [ ] 슬롯 선택 드롭다운이 표시됨
   - [ ] Search 버튼 클릭 시 검색 실행
   - [ ] Enter 키 입력 시 검색 실행

2. **하이라이트 기능**
   - [ ] 검색 결과 노드가 초록색으로 하이라이트됨
   - [ ] 하이라이트된 노드에 펄스 애니메이션 적용
   - [ ] 하이라이트되지 않은 노드는 투명도 0.3
   - [ ] 연결된 링크도 하이라이트됨
   - [ ] 라벨이 볼드체로 표시됨

3. **Clear 기능**
   - [ ] Clear 버튼 클릭 시 하이라이트 제거
   - [ ] 검색 입력 필드 초기화
   - [ ] 모든 노드 스타일 복원

#### ✅ 6.15: 실시간 업데이트

1. **Polling 방식**
   - [ ] "Auto Refresh" 체크박스 활성화
   - [ ] 선택한 간격(5초/10초/30초/1분)마다 자동 새로고침
   - [ ] 데이터 변경 시 맵 업데이트
   - [ ] 변경 없을 때는 업데이트하지 않음 (콘솔 로그 확인)

2. **WebSocket 방식**
   - [ ] 개발자 도구 Console에서 "✅ WebSocket 연결됨" 메시지 확인
   - [ ] 다른 클라이언트에서 앵커 변경 시 실시간 업데이트
   - [ ] WebSocket 연결 종료 시 자동 재연결 시도

3. **Fallback 메커니즘**
   - [ ] WebSocket 실패 시 Polling으로 자동 전환
   - [ ] Agent ID 변경 시 WebSocket 재구독

### 반응형 디자인 테스트 (6.17)

#### 데스크톱 (1920x1080 이상)
- [ ] 헤더가 한 줄로 표시됨
- [ ] 사이드바가 왼쪽에 표시됨 (300px)
- [ ] 맵 컨테이너가 오른쪽에 표시됨
- [ ] Legend가 맵 오른쪽 상단에 표시됨

#### 태블릿 (768px - 1024px)
- [ ] 헤더가 세로로 배치됨
- [ ] 사이드바가 상단에 표시됨 (최대 높이 40vh)
- [ ] 맵 컨테이너가 하단에 표시됨 (높이 60vh)
- [ ] Legend가 상대 위치로 변경됨

#### 모바일 (480px 이하)
- [ ] 헤더 컨트롤이 세로로 배치됨
- [ ] 모든 입력 필드와 버튼이 전체 너비
- [ ] 사이드바가 상단에 표시됨
- [ ] 맵이 하단에 표시됨

## 단계별 테스트 시나리오

### 시나리오 1: 기본 앵커 맵 표시

1. 서버 실행: `npm run dev:http`
2. 브라우저에서 `http://localhost:9001/dashboard` 접속
3. Agent ID 입력 (기본값: "default")
4. "Load Map" 버튼 클릭
5. **확인 사항:**
   - 앵커가 설정되어 있으면 맵에 표시됨
   - 앵커가 없으면 빈 맵 표시

### 시나리오 2: 앵커 설정 및 맵 업데이트

1. MCP 클라이언트 또는 API를 통해 메모리 생성
2. 앵커 설정 (Slot A)
3. 대시보드에서 "Load Map" 클릭
4. **확인 사항:**
   - 앵커 노드가 빨간색으로 표시됨
   - 앵커 주변 메모리들이 표시됨
   - 사이드바에 앵커 목록 표시

### 시나리오 3: 검색 및 하이라이트

1. 맵이 로드된 상태에서
2. 검색 입력 필드에 검색어 입력 (예: "test")
3. 슬롯 선택 (선택 사항)
4. "Search" 버튼 클릭
5. **확인 사항:**
   - 검색 결과 노드가 초록색으로 하이라이트됨
   - 첫 번째 결과로 자동 이동 및 확대
   - 하이라이트되지 않은 노드는 투명하게 표시

### 시나리오 4: 실시간 업데이트 (Polling)

1. "Auto Refresh" 체크박스 활성화
2. 새로고침 간격 선택 (예: 10초)
3. 다른 클라이언트에서 앵커 변경
4. **확인 사항:**
   - 선택한 간격마다 자동으로 맵 업데이트
   - 콘솔에 "✅ 맵 데이터 업데이트됨" 로그 표시

### 시나리오 5: 실시간 업데이트 (WebSocket)

1. "Auto Refresh" 체크박스 활성화
2. 개발자 도구 Console 확인
3. 다른 클라이언트에서 앵커 변경
4. **확인 사항:**
   - "✅ WebSocket 연결됨" 메시지 확인
   - "📨 Anchor Map 업데이트 수신" 메시지 확인
   - 맵이 즉시 업데이트됨 (Polling보다 빠름)

### 시나리오 6: 반응형 디자인

1. 브라우저 개발자 도구에서 디바이스 모드 활성화
2. 다양한 화면 크기로 테스트:
   - iPhone SE (375x667)
   - iPad (768x1024)
   - Desktop (1920x1080)
3. **확인 사항:**
   - 각 화면 크기에서 레이아웃이 적절히 조정됨
   - 모든 컨트롤이 접근 가능함
   - 맵이 정상적으로 표시됨

## 문제 해결

### 대시보드가 로드되지 않는 경우

1. 서버가 실행 중인지 확인: `http://localhost:9001/health`
2. 브라우저 개발자 도구 Console에서 에러 확인
3. Network 탭에서 파일 로드 실패 확인
4. Static 파일 경로 확인: `static/` 디렉토리 존재 여부

### 맵이 표시되지 않는 경우

1. Console에서 D3.js 로드 확인
2. API 응답 확인: `http://localhost:9001/api/anchors/map?agent_id=default`
3. 앵커가 설정되어 있는지 확인
4. JavaScript 에러 확인 (Console 탭)

### WebSocket 연결 실패

1. 서버가 WebSocket을 지원하는지 확인
2. 방화벽 설정 확인
3. 브라우저가 WebSocket을 지원하는지 확인
4. Polling 방식으로 fallback 확인

## 테스트 결과 기록

테스트 완료 후 다음 정보를 기록하세요:

- 테스트 날짜: ___________
- 테스트 환경: ___________
  - OS: ___________
  - 브라우저: ___________
  - 화면 해상도: ___________
- 통과한 테스트: ___________
- 실패한 테스트: ___________
- 발견된 버그: ___________

