# Transports

Memento는 두 가지 transport로 동일한 MCP 도구 세트를 노출합니다.

- **stdio**: 비서가 `memento-mcp-server`를 자식 프로세스로 spawn해서 stdin/stdout으로 통신. 단일 머신, 5분 셋업.
- **HTTP**: Memento를 별도 프로세스(또는 컨테이너)로 띄우고 비서는 `/mcp` 엔드포인트로 접속. 멀티 디바이스, Bearer 토큰 인증.

이 문서는 **어느 트랙을 쓸지 결정**하고 **각 트랙을 띄우는 1줄 명령**까지만 다룹니다. 토큰 관리·시스템 프롬프트·트러블슈팅은 별도 문서를 참조하세요.

---

## 트랙 결정

| 상황 | 권장 트랙 | 이유 |
|---|---|---|
| 비서 1대 + Memento 1대가 같은 머신 | **stdio** | 네트워크 설정 0, 토큰 관리 0 |
| 노트북 + 데스크톱 + 홈서버에서 같은 기억 공유 | **HTTP** | 중앙 1대만 SQLite를 가지고 모든 비서가 거기에 접속 |
| Telegram·Discord 등 멀티채널 봇이 24/7로 떠 있어야 함 | **HTTP** | 비서 호스트가 죽어도 Memento는 살아있음 |
| 비서가 컨테이너 안에서 돌고 SQLite를 마운트하기 어려움 (예: NanoClaw) | **HTTP** | 컨테이너는 호스트의 Memento에 HTTP로만 접근 |
| HTTPS·외부 노출이 필요 (집 밖에서 접속) | **HTTP** + reverse proxy | stdio는 같은 머신 한정 |
| 빠르게 한 번 시험해 보고 싶음 | **stdio** | `npx` 한 줄로 끝 |

> 헷갈리면 **stdio로 시작 → 두 번째 디바이스가 생기면 HTTP로 전환**하는 흐름이 가장 흔합니다. 데이터 마이그레이션은 [§ 트랙 전환 / 마이그레이션](#트랙-전환--마이그레이션)에서 다룹니다.

---

## stdio 트랙

비서가 매 세션 시작 시 `memento-mcp-server`를 spawn하고 표준 입출력 파이프로 MCP JSON-RPC를 주고받습니다.

### 셋업

```bash
npx memento-mcp-server@latest setup
```

위 명령은 `~/.memento/.env`와 SQLite 파일(`~/.memento/memory.db` 기본)을 초기화합니다. 이후 비서의 MCP 설정에 다음과 같이 등록합니다.

```json
{
  "mcpServers": {
    "memento": {
      "command": "npx",
      "args": ["-y", "memento-mcp-server@latest", "start", "--stdio"]
    }
  }
}
```

> 정확한 등록 위치(설정 파일 경로, 키 이름)는 비서마다 다릅니다. [OpenClaw](../openclaw.md), [NanoClaw](../nanoclaw.md), [ZeroClaw](../zeroclaw.md) 가이드를 참조하세요.

### 핵심 환경변수

| 변수 | 의미 | 기본값 |
|---|---|---|
| `DB_PATH` | SQLite 파일 경로 | `~/.memento/memory.db` |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | 임베딩(선택) | 미설정 시 lightweight 임베딩 |

`DB_PATH`를 명시적으로 고정해 두면 나중에 HTTP 트랙으로 전환할 때 같은 데이터를 그대로 쓸 수 있습니다 ([§ 트랙 전환](#트랙-전환--마이그레이션) 참조).

### 트러블슈팅

connect/spawn 실패, `better-sqlite3` 빌드 오류 등은 [`./troubleshooting.md`](./troubleshooting.md)를 참조하세요.

---

## HTTP 트랙

Memento를 호스트(노트북·홈서버·VPS) 1대에 띄우고, 다른 디바이스의 비서들은 그 base URL로 MCP 요청을 보냅니다.

### 셋업

```bash
# 저장소 클론 후
docker compose -f docker-compose.prod.yml up -d
```

기본 노출 포트는 **9001**입니다 (`MCP_SERVER_PORT` 환경변수로 변경 가능). compose 파일은 `nginx`도 함께 띄우므로 80 포트를 점유한다는 점에 주의하세요.

서버가 떴는지 확인:

```bash
curl http://localhost:9001/health
```

### 엔드포인트

- **MCP**: `POST http://<host>:9001/mcp` (JSON-RPC), `GET http://<host>:9001/mcp` (SSE/streamable HTTP)
- **Health**: `GET http://<host>:9001/health`
- **Admin 대시보드**: `http://<host>:9001/admin` (admin 자격증명 필요)

### 인증

비서는 `/mcp`에 요청할 때 `Authorization: Bearer <token>` 헤더를 보내야 합니다. 토큰 발급·저장·로테이션은 [`./auth.md`](./auth.md)에서 다룹니다.

> `/auth/session`은 *대시보드 쿠키 세션 발급*용 별도 엔드포인트로, MCP Bearer 토큰과는 무관합니다. 비서 통합에는 사용하지 않습니다.

### 비서 등록 스니펫 (개념)

```json
{
  "mcpServers": {
    "memento": {
      "type": "http",
      "url": "https://memory.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${MEMENTO_TOKEN}"
      }
    }
  }
}
```

JSON 키 이름과 transport 식별자(`type`, `transport` 등)는 비서마다 다릅니다. 비서별 가이드를 참조하세요.

### 핵심 환경변수 (서버 측)

| 변수 | 의미 | 기본값 |
|---|---|---|
| `DB_PATH` | SQLite 파일 경로 (컨테이너 내부) | `/app/data/memory.db` |
| `MCP_SERVER_PORT` / `PORT` | HTTP 서버 포트 | `9001` |
| `LOG_LEVEL` | 로그 레벨 | `info` |

볼륨 마운트로 호스트의 데이터 디렉터리를 컨테이너의 `DB_PATH`에 매핑하면 컨테이너를 재생성해도 기억이 유지됩니다 (`docker-compose.base.yml` 참조).

### HTTPS / 외부 노출

집 밖에서 접속하려면 reverse proxy(예: 동봉 nginx, Caddy, Cloudflare Tunnel)에서 TLS 종단을 처리하세요. compose 파일의 nginx 서비스는 SSL 인증서 마운트를 위한 자리만 잡혀 있으므로 직접 채워야 합니다.

---

## 트랙 전환 / 마이그레이션

**핵심 사실**: stdio 서버와 HTTP 서버는 둘 다 `DB_PATH` 환경변수가 가리키는 *같은 SQLite 파일*을 본다면 같은 기억 데이터를 공유합니다. 즉 transport는 데이터 레이어와 직교합니다.

### stdio → HTTP 마이그레이션

1. stdio 서버를 띄울 때 사용하던 SQLite 파일 위치를 확인합니다 (기본 `~/.memento/memory.db`).
2. 호스트(또는 홈서버)의 데이터 디렉터리로 그 파일을 복사합니다. 옮기기 전 **모든 비서를 종료**해 SQLite WAL 파일까지 fsync된 상태에서 복사하세요.
   ```bash
   cp ~/.memento/memory.db* /srv/memento/data/
   ```
3. `docker-compose.prod.yml`의 볼륨 마운트가 그 디렉터리를 가리키도록 `docker-compose.override.yml`을 작성하거나 환경변수를 설정합니다.
4. `docker compose -f docker-compose.prod.yml up -d`로 띄우고 `/health`를 확인합니다.
5. 비서 측 MCP 설정을 stdio 항목에서 HTTP 항목으로 교체하고, 같은 사용자 식별자(`owner_id`)로 회상이 되는지 검증합니다.

### HTTP → stdio 다운그레이드

같은 절차를 역방향으로 적용합니다. 단, 멀티 디바이스에서 쓰던 데이터를 단일 머신으로 좁히는 거라면 다른 디바이스의 비서들이 더 이상 그 기억에 접근할 수 없게 된다는 점을 의식하세요.

### 동시에 양쪽을 띄워도 되는가

원칙적으로 **권장하지 않습니다**. 같은 SQLite 파일을 stdio 서버 프로세스와 HTTP 서버 프로세스가 동시에 잡으면 SQLite WAL 모드에서 충돌이 나거나 한쪽이 잠금 대기로 멈출 수 있습니다. "전환"은 한쪽을 내리고 다른 쪽을 올리는 흐름으로 진행하세요.

### owner_id / 채널 태그

여러 비서가 같은 Memento에 붙을 때 `owner_id`를 동일하게 두면 채널을 넘나들며 기억을 공유합니다. 채널을 구분하려면 `tags`에 `channel:telegram` 같은 라벨을 넣으세요. 이 모델은 v0.2의 `@memento/assistant` SDK가 자동 적용하며, 베어 MCP만 쓸 때는 비서 시스템 프롬프트에서 명시해야 합니다 ([`./system-prompt.md`](./system-prompt.md)).

---

## 다음 단계

- [`./auth.md`](./auth.md) — Bearer 토큰 발급, 저장 위치, 로테이션
- [`./system-prompt.md`](./system-prompt.md) — recall/remember 호출을 유도하는 권장 프롬프트
- [`./troubleshooting.md`](./troubleshooting.md) — 연결 실패, 401, 검색 결과 비어있음 등
- [통합 가이드 허브](../README.md) — 비서별 가이드로 돌아가기
