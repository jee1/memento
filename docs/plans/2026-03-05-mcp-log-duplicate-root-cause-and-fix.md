# MCP 로그 두 번 출력 근본 원인 및 수정 설계

## 문제
- MCP 서버(user-project-memento) stderr 로그가 동일한 메시지가 연속 두 줄씩 출력됨.
- [BATCH], [SERVER], pipe 형식(타임스탬프 | 레벨 | 메시지) 모두 동일.

## 근본 원인 가설
**Cursor가 동일한 Memento MCP 서버를 두 개의 Node 프로세스로 기동함.**

- 식별자 `user-project-memento`는 "user" MCP와 "project" MCP가 같은 서버를 가리킬 때 붙는 이름으로 추정.
- 두 프로세스가 같은 DB/설정으로 동시에 기동되며, 각각 배치 스케줄러를 돌리고 동일한 로그를 stderr에 기록.
- Cursor가 두 프로세스의 stderr를 한 창에 모아 보여주므로, 모든 로그가 두 번씩 찍혀 보임.
- dedup을 인스턴스/모듈 단위로 해도 **프로세스가 둘**이면 각 프로세스는 자신만의 dedup 상태를 가지므로, “같은 메시지 두 번”이 그대로 두 줄로 출력됨.

## 검증 방법
- 시작 시 **프로세스 PID와 짧은 인스턴스 ID**를 stderr에 한 줄 출력.
- 로그에서 해당 줄이 **서로 다른 PID/ID로 두 번** 보이면, 프로세스가 두 개 기동된 것으로 확인 가능.

## 수정 방향

### 1) 단일 인스턴스 보장 (권장)
- **같은 데이터 디렉터리(같은 DB)**를 쓰는 MCP 서버가 **동시에 한 프로세스만** 뜨도록 lock file로 제한.
- 두 번째 프로세스는 lock 획득 실패 시 **즉시 종료**하고, stderr에 “이미 다른 인스턴스가 실행 중(PID: …)” 메시지를 남김.
- 효과: 로그 중복 제거, 배치/DB 접근이 한 프로세스로만 이루어져 일관성 유지.

### 2) Lock 파일 동작
- **위치**: `DB_PATH`가 `./data/memory.db`이면 lock 파일은 `./data/memento-mcp.lock`.
- **내용**: 현재 프로세스 PID (한 줄).
- **획득**:  
  - 파일 없음 → PID 기록 후 정상 기동.  
  - 파일 있음 → 기존 PID 읽어서 해당 프로세스가 아직 살아 있는지 확인(`process.kill(pid, 0)` 등).  
    - 살아 있으면 → “이미 실행 중” 메시지 출력 후 `process.exit(0)`.  
    - 죽었으면 → 기존 파일 삭제 후 새 PID로 lock 파일 생성하고 기동.
- **해제**: 프로세스 종료 시(cleanup, SIGINT/SIGTERM) lock 파일 삭제.

### 3) 진단 로그
- **첫 줄**: transport 연결 전에도 보이도록 `process.stderr.write`로 직접 한 줄 출력.  
  예: `[Memento MCP] instance pid=12345 id=a1b2c3d4`
- 필요 시 환경 변수 `MEMENTO_SINGLETON=0`으로 lock 비활성화(기본값은 1로 단일 인스턴스 적용).

## 부수 효과
- Cursor에서 Memento가 “user”와 “project” 양쪽에 등록되어 있으면, **둘 중 하나만 실제로 기동**되고 나머지는 시작 시 바로 종료됨.
- 사용자는 Cursor MCP 설정에서 **한 쪽만** Memento를 쓰도록 정리하면, 의도적으로 두 설정을 쓸 때만 lock 비활성화하면 됨.

## 구현 범위
- `packages/memento-server/src/server/instance-lock.ts` (또는 루트 `src/server/instance-lock.ts`): lock 획득/해제, PID 존재 여부 확인.
- `packages/memento-server/src/server/index.ts`:  
  - 가능한 한 초반에 진단용 한 줄 stderr 출력.  
  - DB 경로 확정 직후 lock 획득, 실패 시 메시지 출력 후 exit.  
  - cleanup 시 lock 해제.

---

## 검증 결과 (2026-03-05)

- **터미널에서 직접 실행** (루트에서 `npm run build` 후 `node packages/memento-server/dist/server/index.js` 또는 `npm start`) 시: 각 로그가 **한 번만** 출력됨.
- **Cursor MCP 로그 창**에서는 동일 메시지가 **두 번** 표시됨.
- **결론**: 중복 출력의 원인은 **Cursor MCP 클라이언트(또는 로그 UI)**가 stderr를 두 번 수신·표시하는 쪽으로 확인됨. 서버는 stderr에 한 번만 쓰고 있으므로, 서버 코드 변경만으로는 Cursor 창에서의 중복을 제거할 수 없음.
- **대응**: Cursor 쪽 이슈/설정 확인 또는 업데이트 대기. 서버는 단일 인스턴스 lock 및 진단 로그만 유지.
