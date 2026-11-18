# ADR: 접속 클라이언트와 도구 호출 결과를 로컬에만 일별로 집계한다 (이슈 #1768)

- 상태: Accepted (2026-11-18). 설계 리뷰(머슴5) 지적 9건을 반영했고 마름이 재확인한 뒤 구현했다. 구현 중 알게 된 것은 「구현에서 알게 된 것」 절에 적었다
- 날짜: 2026-11-18
- 이슈: https://github.com/jee1/memento/issues/1768
- 관련: #1769(`memento doctor --report`, 이 집계를 읽는다), #1774(옛 방식 접속 경로를 지울 시점)
- 바탕: 사용자 결정(2026-11-18). 사용 정보는 바깥에 자동으로 보내지 않는다. 로컬 집계, 진단 보고 명령, 공개 숫자로 본다.

## 요약

- 서버가 도구 호출과 연결 신호를 자기 DB 의 일별 집계 표 `usage_daily_count` 에만 센다. 바깥으로 보내는 코드는 없다.
- 집계 칸은 열거값, 등록된 도구 이름, 모양을 제한한 버전 문자열뿐이다. 자유 문자열 칸이 없다. 단 DB 제약이 막는 범위에는 한계가 있고 마지막 방어선은 앱 정규화와 테스트다(결정 1에서 칸마다 적는다).
- 한 행의 열쇠는 날짜, 클라이언트 이름, 클라이언트 버전, 접속 방식, 프로토콜 시대, 요청 종류, 도구, 결과, 오류 코드다. 값은 횟수 하나다.
- 클라이언트 정보는 시대마다 다른 곳에서 읽는다. 새 방식은 요청마다 `_meta` 의 `io.modelcontextprotocol/clientInfo`, 옛 방식은 `initialize` 의 `clientInfo` 를 세션 ID 에 묶어 기억한다. **세 클라이언트가 실제로 보내는 값을 2026-11-18 로컬 탐침으로 확인했다**(「확인한 것」 절).
- 도구 호출은 `dispatchTool` 한 곳에서 센다. 세는 지점은 `executionStarted` 와 무관한 바깥 래퍼다(결정 3).
- 쓰기는 메모리 `Map` 에 모아 30초마다와 종료 때 한 트랜잭션으로 쓴다(결정 4). 호출 경로에 DB 쓰기를 더하지 않는다.
- 행 수는 하루 열쇠 2,000개로 막는다(결정 5).
- 보관은 365일이다. 기존 정리 잡에 붙이되 집계 삭제는 따로 `try/catch` 로 분리한다. 설정 키는 더하지 않는다.
- 이슈 배경의 「`/mcp` 요청 6% 실패」는 대부분 실패가 아니다(「숫자 정정」 절).

## 확인한 것: 클라이언트가 실제로 보내는 값 (2026-11-18)

임시 로컬 서버(요청 헤더와 `clientInfo` 만 기록, 저장 없음, 인증 없음)에 세 클라이언트를 직접 붙여 요청을 받았다. 사용자 설정(`~/.claude.json`, `~/.cursor/mcp.json`)은 바꾸지 않았다. cursor-agent 는 실행 한 번에만 서버를 승인하는 `--approve-mcps` 로 돌렸다.

| 클라이언트 | 시대 | 클라이언트 정보가 오는 곳 | `name` 원문 | `version` 원문 | 뒤 요청에 `mcp-session-id` 를 다시 보내나 |
|---|---|---|---|---|---|
| Claude Code 2.1.327 | modern (`2026-07-28`) | **모든 요청**의 `_meta['io.modelcontextprotocol/clientInfo']` (`initialize` 없음, `server/discover` 로 시작) | `claude-code` | `2.1.327` (제목 `Claude Code`) | 해당 없음(세션 없음) |
| opencode 1.19.6 | legacy (`2025-11-25`) | `initialize` 의 `params.clientInfo` | `opencode` | `1.19.6` | **보낸다** (`tools/list` 에도 서버가 준 값) |
| cursor-agent 2026.11.17 | legacy (`2025-11-25`) | `initialize` 의 `params.clientInfo` | `Cursor` (**대문자 시작**) | `1.0.0` (**cursor-agent 버전이 아니다**) | **보낸다** |

이 결과로 바뀐 것:

1. **새 방식의 `_meta` 키는 실제로 온다.** 리뷰 5의 첫 우려는 풀렸다. 그래도 SDK 스키마에서 선택 항목이므로 없으면 `unknown` 으로 센다(코드는 키가 없을 때를 처리한다).
2. **옛 방식 클라이언트는 세션 헤더를 다시 보낸다.** 리뷰가 제안한 대비안(API 키 ID 에 묶기)은 두지 않는다. 같은 키를 여러 클라이언트가 쓰면 틀리는 안이고, 실측으로 필요가 없음이 확인됐다. 헤더가 없을 때 `unknown` 인 것은 그대로다.
3. **이름은 소문자로 정규화한 뒤 목록과 대조한다.** `Cursor` → `cursor`. 목록 값은 `claude-code`, `cursor`, `opencode` 부터 시작한다.
4. **cursor-agent 의 버전 `1.0.0` 은 클라이언트가 자기를 어떻게 소개하느냐의 값이라 도구 버전과 무관하다.** 이 칸은 「클라이언트가 말한 버전」이지 「설치된 도구 버전」이 아니라고 문서와 테스트 이름에 적는다. cursor 의 버전별 차이는 이 칸으로 가를 수 없다.

**아직 모르는 것** (구현 PR 의 수동 확인 항목): codex, gemini-cli, vscode 같은 나머지 목록 후보의 `name` 원문. 이 환경에서 확인하지 못했다. 목록에 없는 이름은 `other` 로 세고 정규화한 이름을 로그에 남기므로(결정 2) 주인이 보고 목록에 더한다.

## 숫자 정정: 「`/mcp` 요청 6% 실패」

두 출처의 분모가 다르다.

| 출처 | 기간 | 분모 | 비율 |
|---|---|---|---|
| `audit_log` (이슈 본문) | 최근 30일 | `/mcp` 24,013건 중 실패 1,428건 | 6% |
| `http-audit.jsonl` (이 문서) | 2026-09-05 부터 | `/mcp` 63,545줄 중 상태 405/401/404/400/500 합 5,727줄 | 9.0% |

405 가 4,584줄로 두 출처 모두에서 실패의 약 80% 를 차지한다. 새 방식 클라이언트가 보낸 GET 에 서버가 규약대로 405 를 돌려준 것이다(`handlers.ts:60`). 진짜 서버 오류(500)는 3줄이다. HTTP 응답 상태는 `http-audit.jsonl` 에 이미 있어 이 집계에 옮기지 않는다. `http-audit.jsonl` 은 읽기 전용 원본이고 이 문서를 고치면서 다시 재지는 않았다.

## 구현에서 알게 된 것

설계 뒤 구현하면서 설계 문서가 말하지 않았거나 틀렸던 것을 실제 서버와 운영 DB 사본으로 확인했다.

| 발견 | 설계 문서 | 구현에서 한 일 |
|---|---|---|
| 새 방식 클라이언트는 연결 직후 `tools/list` 를 먼저 보내는데, 그때 stdio 서버의 DB 는 아직 준비 중(`heavy init`)이라 첫 신호가 빠졌다 | 「준비 전이면 DB 가 없어 세지 않는다」는 처리만 있었다 | 응답은 늦추지 않고, 준비되는 대로 백그라운드에서 센다(`readyPromise.then`). 연결 정보는 요청이 끝나면 쓸 수 없으므로 지금 읽어 둔다. 실제 stdio 서버에서 첫 `tools/list` 가 남는 것을 확인했다 |
| 옛 방식 `initialize` 요청 자신에는 `mcp-session-id` 헤더가 없다(서버가 응답에서 처음 준다) | 「세션 ID 로 기억해 뒤 요청에 붙인다」만 있었다 | `initialize` 의 연결 신호는 방금 서버가 정한 세션 ID 로 기억소를 찾는다. 안 그러면 `initialize` 행이 `unknown` 이 된다(통합 테스트가 잡았다) |
| 새 방식 envelope 에 `clientInfo` 가 런타임에 있다. 단 SDK 타입은 `RequestMetaEnvelope = {}` 로 비어 있다 | 「`CLIENT_INFO_META_KEY` 로 읽는다」 | 키 문자열로 읽는다. 실제 stdio 서버에서 `claude-code 2.1.327` 이 남는 것을 확인했다 |
| 새 방식 요청은 `Mcp-Method`, `Mcp-Name` 헤더가 없으면 서버가 `-32020` 으로 거부한다 | 언급 없음 | 통합 테스트의 새 방식 요청 픽스처가 이 헤더를 함께 보낸다 |
| `client_version` 을 `GLOB '*[^0-9.]*'` 로만 막으면 `1.2.3.4`, `1..2` 가 통과한다 | 「숫자 세 조각 모양」 | 점 개수(정확히 둘)와 앞뒤, 연속 점을 SQL 로 막는다. 모양 밖 값 열네 개를 SQLite 에서 직접 확인했다 |
| 옛 바이너리(main)가 069 가 적용된 DB 를 열 수 있는가 | 「옛 바이너리는 새 표를 무시한다」(주장만) | 운영 DB 사본을 069 로 올린 뒤 main 빌드로 열어 확인했다. 오류 없이 열리고 데이터가 그대로다 |

## 용어

용어집(`GLOSSARY.md`)에 「운영」 절을 새로 만들어 다음을 더한다.

| 용어 | 뜻 |
|---|---|
| 접속 클라이언트 (Client) | MCP 로 Memento 에 붙는 프로그램(Claude Code, Cursor, opencode 등). 사람이나 에이전트가 아니다 |
| 접속 방식 (Connection method) | 클라이언트가 메시지를 나르는 길. `stdio`, `http-streamable`, `http-sse`, `websocket`, `rest` |
| 프로토콜 시대 (Protocol era) | MCP 규약의 세대. `legacy` 는 2025-11-25 까지의 판으로 `initialize` 로 연결을 연다. `modern` 은 2026-07-28 판으로 `initialize` 가 없고 요청마다 `_meta` 에 판과 클라이언트 정보를 싣는다. REST 와 WebSocket 은 MCP 시대가 없어 `none` |
| 사용 집계 (Usage aggregate) | 접속 클라이언트, 접속 방식, 프로토콜 시대, 도구별 호출 결과를 날마다 센 로컬 기록. 바깥으로 나가지 않는다 |

이슈 본문은 접속 방식을 넷(`stdio`, `http-streamable`, `http-sse`, `rest`)으로 적었지만 코드에는 WebSocket 경로(`http-server-websocket.ts:161`, 운영 30일 20건)가 있다. 빼면 그 호출이 다른 칸으로 잘못 들어가므로 `websocket` 을 더한다.

## 결정

### 결정 1. 새 집계 표를 만들고, 칸마다 DB 제약을 달되 제약의 한계를 사실대로 적는다

| 안 | 얻는 것 | 비용 |
|---|---|---|
| **A. 새 표 `usage_daily_count` (고름)** | 칸마다 DB 제약. 행 수가 (날짜 × 조합) 으로 묶여 작다. #1769 가 그대로 읽는다 | 마이그레이션 1개, 스키마 변경이라 설계 리뷰 |
| B. 기존 `telemetry_daily_metrics` 재사용 | 표를 더하지 않는다 | 열쇠가 (날짜, `event_type`, `owner_id`) 뿐이라 차원을 문자열에 이어 붙여야 한다. 자유 문자열 칸이 생긴다 |
| C. 원시 이벤트를 `telemetry_events` 에 쌓고 읽을 때 센다 | 칸을 나중에 바꾸기 쉽다 | 호출마다 한 행(운영 30일 도구 호출 약 8,600건)이 90일 보관으로 쌓인다. `extra_data` 가 JSON 이라 DB 가 막지 못한다 |

A 를 고른 이유는 앱 코드와 DB 두 겹으로 지키기 때문이다. **그러나 DB 제약이 모든 칸을 같은 힘으로 막지는 않는다.** 칸마다 무엇이 막히고 무엇이 통과하는지 적는다.

| 칸 | DB 제약 | 막는 것 | 통과하는 것 (마지막 방어선) |
|---|---|---|---|
| `client_name` | `CHECK IN (...)` (알려진 목록 + `other` + `unknown`) | 목록 밖 모든 값 | 없음. 목록을 바꾸면 표를 다시 만드는 마이그레이션이 필요하다 |
| `client_version` | 모양 `CHECK`: `^[0-9]+\.[0-9]+\.[0-9]+$` 에 해당하는 `GLOB`, 길이 ≤ 24 | 경로, 문자, 접미사 | 숫자 세 조각 모양의 값(정상 버전과 구별 불가) |
| `connection_method`, `era`, `request_kind`, `outcome`, `error_code` | `CHECK IN (...)` | 목록 밖 모든 값 | 없음 |
| `tool` | 모양 `CHECK`: 길이 ≤ 64, `[a-z0-9_]` 만 | 경로, 공백, 대문자, `:` | **소문자 단어, 16진 토큰, 프로젝트 이름처럼 모양이 맞는 문자열.** 마지막 방어선은 앱 정규화(등록된 도구 이름이 아니면 `other`)와 테스트 1 |
| `outcome` / `error_code` 짝 | `CHECK ((outcome = 'success') = (error_code = 0))` | 성공인데 오류 코드가 있거나 그 반대 | 없음 |

`client_name` 을 `CHECK IN` 으로 올린 것은 리뷰 지적 1(b)을 따른 것이다. 이전 판은 모양 제약으로 두는 쪽을 권했는데, 목록은 열 개 안팎이고 목록을 바꾸는 사람은 주인뿐이라 표 재생성 비용을 감수할 만하다. 모양 제약만으로는 `memento` 같은 프로젝트 이름이 그대로 들어간다. 클라이언트를 더하는 PR 은 마이그레이션 하나(표 재생성)를 같이 낸다.

`tool` 이 정규화하는 기준은 `getAllTools()` 다. `getExposedTools()` 는 기본 `core` 모드에서 `recall`, `remember`, `memory_injection`, `feedback` 네 개만 돌려줘서(`tools/index.ts:79`, 기본 `MEMENTO_TOOLSET=core`), REST 나 WebSocket 으로 부르는 나머지 도구가 모두 `other` 로 합쳐진다. 노출 안 된 도구를 부르는 클라이언트도 보여야 하므로 `getAllTools()` 를 쓴다.

테스트 2 에 모양은 맞지만 목록 밖인 값(`client_name = 'zzz'`)을 넣어 `CHECK IN` 이 거부하는지 본다. 반대로 `client_version` 은 숫자 세 조각 모양이면 어떤 값이든 DB 가 받는다(`12.34.56` 도 통과).

### 결정 2. 클라이언트 정보는 시대마다 읽는 곳이 다르다

| 접속 방식 | 시대 판별 | 클라이언트 이름과 버전 |
|---|---|---|
| `http-streamable` | 메시지 `_meta` 에 `io.modelcontextprotocol/protocolVersion` 이 있으면 `modern` (`hasModernProtocolClaim`, 지금 코드) | `modern`: 같은 요청 `_meta['io.modelcontextprotocol/clientInfo']` (실측: Claude Code 가 모든 요청에 보낸다). `legacy`: `initialize` 의 `params.clientInfo` 를 응답 헤더로 준 `mcp-session-id` 에 묶어 기억하고, 뒤 요청은 그 헤더로 찾는다 (실측: opencode 와 cursor-agent 가 뒤 요청에 헤더를 다시 보낸다) |
| `http-sse` | 항상 `legacy` | `initialize` 의 `clientInfo` 를 SSE 연결 객체(`transports[sessionId]`)에 붙인다 |
| `stdio` | SDK v2 `ServerContext.mcpReq.envelope` 가 있으면 `modern` | `modern`: envelope 의 클라이언트 정보(`CLIENT_INFO_META_KEY`). `legacy`: `server.getClientVersion()`. `MEMENTO_MCP_ERA=legacy` 경로(`index.ts` `registerHandlers`)도 같은 함수를 쓴다 |
| `websocket`, `rest` | `none` | MCP 클라이언트 정보가 없어 `unknown` |

옛 방식 HTTP 의 세션 기억은 메모리에만 둔다. 개수 상한은 1,000개이고 **읽을 때마다 최근 사용으로 갱신하는 LRU** 라서, 오래 열린 세션이 새 세션 1,000개에 밀려나지 않는다. **키(`mcp-session-id`)는 128자를 넘으면 기억하지 않는다.** 클라이언트가 보낸 헤더 값이 키라서 개수만 막으면 키 길이로 메모리가 자란다(헤더 한도 16KB 안팎이면 최악 약 16MB). 값은 원문 `clientInfo` 가 아니라 정규화한 (이름, 버전) 쌍만 둔다. 서버를 다시 띄우면 다음 `initialize` 까지 그 연결은 `unknown` 이다.

| 버린 안 | 이유 |
|---|---|
| 세션 기억을 DB 에 둔다 | 재시작 직후 몇 건의 `unknown` 을 줄이려고 세션 표를 하나 더 둔다. 결정에 쓰이는 숫자가 바뀌지 않는다 |
| 옛 방식은 `initialize` 횟수만 세고 도구 호출에는 클라이언트를 붙이지 않는다 | 「클라이언트별로 실패가 몰리는가」를 볼 수 없다. 실측으로 옛 방식 클라이언트 둘(opencode, cursor-agent)이 세션 헤더를 다시 보내 이름을 붙일 수 있음이 확인됐다 |
| 세션 헤더가 없을 때 API 키 ID 에 묶어 기억한다 (리뷰 5 제안) | 같은 키를 여러 클라이언트가 쓰면 틀린다. 실측으로 대비가 필요한 클라이언트가 없었다 |

**이름 정규화.** 소문자로 바꾸고 알려진 목록(`claude-code`, `cursor`, `opencode` 로 시작. codex, gemini-cli, vscode, zed, windsurf, cline, mcp-inspector 는 구현 PR 에서 원문을 확인한 뒤 더한다)과 대조해 맞으면 그 값, 아니면 `other` 로 적는다. 목록에 없는 이름은 프로세스마다 한 번 `client_name_unrecognized` 를 info 로그에 남긴다. **이름은 소문자 영문자와 하이픈만 있는 20자 이하일 때만 로그에 남긴다**(2차 리뷰 지적 1). 토큰, 경로, 식별자 모양(숫자, 점, 밑줄, 긴 값)은 이름 대신 「이름은 남기지 않음, 길이 N」만 한 번 남겨 새 클라이언트가 있다는 신호는 잃지 않는다. **중복 제거용 Set 은 32개까지만 기억하고 넘으면 더 남기지 않는다**(리뷰 7). 이 로그 줄은 둔다. 없으면 `other` 에 묻힌 새 클라이언트를 영영 보지 못한다. 집계 표에는 이 값을 넣지 않는다.

**버전 정규화.** `major.minor.patch` 세 조각만 남긴다. 접미사(prerelease, build)는 버린다. **이름이 `other` 또는 `unknown` 이면 버전은 빈 문자열이다.** 이 두 규칙은 결정 5 의 행 수 상한과 짝이다.

### 결정 3. 세는 곳은 두 곳이고, 도구 호출은 바깥 래퍼에서 센다

| 무엇 | 어디서 | 이유 |
|---|---|---|
| 도구 호출 (`tools/call`) | `audit-tool-dispatch.ts` 의 `createToolDispatcher` 반환 함수를 바깥에서 감싸는 래퍼. `try/catch/finally` 전체를 지난 뒤 결과(성공 또는 던져진 오류의 JSON-RPC 코드)를 센다 | 이미 stdio, HTTP, WebSocket, REST 가 모두 지나는 실행 경계다. 안쪽 `recordToolAudit` 옆에서 세면 `executionStarted` 가 `true` 가 되기 전에 던지는 오류(`scopeArgsToBoundAgent` 의 `-32602` 토큰 묶임 위반, `assertToolAuditCoverage`)가 빠진다(리뷰 4) |
| 연결 신호 (`initialize`, `tools/list`) | HTTP: `processMcpMessage`. stdio: `createMementoMcpServer` 의 `tools/list` 처리기와 SDK 의 `initialize` 완료 시점(`oninitialized`) | 새 방식에는 `initialize` 가 없어 `tools/list` 가 「붙었다」의 대용이다. 도구를 부르지 않고 붙기만 한 클라이언트도 보인다 |

`ToolAuditContext` 에 `usage: { connectionMethod, era, client }` 를 더해 각 진입점이 채운다. `transport`(감사 기록의 값)는 그대로 둔다. 집계에서만 `mcp_http` 를 `http-streamable` 과 `http-sse` 로 나눈다. 감사 표의 `CHECK` 와 해시 체인을 건드리지 않으려는 선택이다.

**오류 코드 목록을 줄인다.** 이전 판은 `-32700 -32600 -32601 -32020 -32021 -32022` 도 허용했는데, 이 값들은 `dispatchTool` 에 닿기 전에 HTTP 계층(`handlers.ts:170,216,237`, `modern-request-validation.ts:26,33`)이 만든다. 결정 3 의 세는 곳에 이 계층이 없으니 들어갈 행이 없는 죽은 값이었다. **프로토콜 단계 거부는 세지 않는다.** #1774(옛 방식 경로를 지울 시점)가 보려는 것은 「옛 방식으로 붙는 클라이언트가 있는가」이고, 이는 `era='legacy'` 의 `initialize` 와 `tools/list` 횟수로 충분하다. 지원하지 않는 판을 주장하는 클라이언트를 따로 보려면 그때 칸을 더한다.

허용 오류 코드는 0(성공), `-32602`(잘못된 인자), `-32603`(내부 오류), `-32003`(범위 거부), `-32009`(버전 충돌), `-32601`(등록되지 않은 도구, 아래), `-1`(그 밖)로 줄인다. `-32601` 은 HTTP 계층(`message-processor.ts:75,165,170,183`)에서 요청 단계로도 만들어지지만 그쪽은 세지 않는다. 세는 것은 `dispatchTool` 안에서 `Unknown tool:` 오류가 `mapToolExecutionErrorToJsonRpc` 를 거쳐 만드는 `-32601` 뿐이다(`mcp-tool-call-error.ts:74`). 이때 `tool` 칸은 등록된 이름이 아니므로 `other` 가 된다.

세지 않는 것: `prompts/*`, `resources/*`(빈 응답), `notifications/*`, `ping`, 프로토콜 단계 거부, HTTP 응답 상태. HTTP 상태는 `http-audit.jsonl` 에 이미 있다.

### 결정 4. 메모리에 모아 주기와 종료 때 한 트랜잭션으로 쓴다

이전 판은 「호출마다 UPSERT」를 골랐고, 메모리에 모으는 안을 「다중 프로세스 처리가 더 든다」는 이유로 버렸다. 리뷰 3 이 두 가지를 바로잡았다.

1. **호출마다 쓰기는 요청 처리 시간을 늘리지 않는다고 말할 수 없다.** 운영 DB 의 `busy_timeout` 은 60,000ms 이고(`init-sqlite-session.ts:31`) better-sqlite3 쓰기는 동기다. 다른 프로세스(stdio 여러 개, 배치 잡)가 쓰기 잠금을 쥐면 호출 쪽 이벤트 루프가 최대 60초 멈춘다. 「실패는 삼킨다」는 그 대기가 끝난 뒤에야 일어난다. 호출마다 감사 해시 체인 1행에 더해 집계 쓰기 1번이 같은 경로에 얹힌다.
2. **메모리에 모으는 안은 다중 프로세스에서도 합쳐진다.** `ON CONFLICT DO UPDATE SET count = count + excluded.count` 면 프로세스마다 따로 모았다 flush 해도 더해진다. 필요한 것은 flush 타이머와 종료 시 한 번 더 비우기뿐이다.

| 안 | 얻는 것 | 비용 |
|---|---|---|
| **메모리 `Map` 에 모아 30초마다와 종료 때 한 트랜잭션으로 쓴다 (고름)** | 호출 경로에 DB 쓰기가 없다. 프로세스 여럿이 같은 DB 에 써도 `count + excluded.count` 로 합쳐진다. flush 한 번이 여러 행이어도 트랜잭션 하나다 | 타이머와 종료 훅. 비정상 종료(`SIGKILL`, 전원)에서 최대 30초치를 잃는다. 진단 집계에 허용되는 손실이다 |
| 호출마다 UPSERT | 코드가 짧고 비정상 종료에도 그때까지 센 값이 남는다 | 위 1번. 경합 중 쓰기 지연을 측정해 문서에 적어야 한다(측정하지 않았다) |

고른 안의 세부:

- `Map` 의 키는 열쇠 아홉 칸을 이어 만든 문자열이고 값은 횟수다. 키 수는 결정 5 의 상한이 막는다.
- flush 는 `INSERT ... ON CONFLICT DO UPDATE SET count = count + excluded.count` 를 한 트랜잭션으로 묶는다. 실패하면 그 `Map` 을 버리지 않고 다음 주기에 다시 시도하되, `Map` 이 상한의 두 배를 넘으면 오래된 쪽부터 버리고 경고를 한 줄 남긴다.
- 종료 때 한 번 더 flush 한다. `SIGTERM` 과 `SIGINT` 처리(`index.ts` 의 `handleShutdown`)와 정상 `close` 에서 부른다.
- 집계 쓰기가 실패해도(잠김, 표 없음) 도구 호출에는 영향이 없다. 호출 경로는 `Map` 만 만지기 때문이다.
- 테스트 시간을 위해 flush 간격은 생성자 인자로 받고 기본값 30초는 상수다. 설정 키는 더하지 않는다.

### 결정 5. 행 수는 하루 열쇠 2,000개로 막는다

이전 판의 「하루 상한 수백 행」은 정상 클라이언트를 가정한 말이었다. 버전을 semver 접미사까지 허용하면 인증된 클라이언트가 요청마다 `1.0.N` 이나 임의 접미사를 보내 날마다 새 행을 만들 수 있고 365일 보관된다.

막는 길은 세 겹이다.

1. 버전에서 접미사를 버리고 `major.minor.patch` 만 남긴다(결정 2).
2. 이름이 `other` 또는 `unknown` 이면 버전은 빈 문자열이다(결정 2). 알려진 이름만 버전이 갈린다.
3. 하루 서로 다른 열쇠 수가 2,000개에 닿으면 이후 새 열쇠는 `client_version=''` 으로 합친다. 그래도 새 열쇠면 `client_name='other'`, `client_version=''` 으로 합친다. 한도에 닿은 날 경고를 한 줄 남긴다.

2,000 은 근거 있는 수치가 아니라 정상 사용량(클라이언트 10종 × 버전 20 × 방식 5 × 도구 10 × 결과 2 의 곱 가운데 실제로 나오는 조합은 수십~수백)의 열 배쯤을 잡은 값이다. 한도에 자주 닿으면 그때 조정한다.

## 설계

### 행 모양 (`UsageCountKey`)

| 칸 | 값 | DB 제약 (결정 1 의 표) |
|---|---|---|
| `day` | UTC `YYYY-MM-DD` | `length(day) = 10` |
| `client_name` | 알려진 목록, `other`, `unknown` | `CHECK IN` |
| `client_version` | `major.minor.patch` 또는 빈 문자열 | 모양 `CHECK`, 길이 ≤ 24 |
| `connection_method` | `stdio`, `http-streamable`, `http-sse`, `websocket`, `rest` | `CHECK IN` |
| `era` | `legacy`, `modern`, `none` | `CHECK IN` |
| `request_kind` | `initialize`, `tools/list`, `tools/call` | `CHECK IN` |
| `tool` | `getAllTools()` 의 이름, `other`, 또는 빈 문자열(`tools/call` 이 아닐 때) | 모양 `CHECK` |
| `outcome` | `success`, `error` | `CHECK IN` |
| `error_code` | 0, `-32602`, `-32603`, `-32003`, `-32009`, `-32601`, `-1` | `CHECK IN` |
| `count` | 정수 | `count >= 1` |

열쇠는 `count` 를 뺀 아홉 칸 전체(`PRIMARY KEY`)다. 표는 `WITHOUT ROWID` 로 만든다. 9칸 열쇠를 rowid 표와 자동 인덱스에 이중으로 저장하지 않으려는 것이다.

허용 값 목록은 `packages/memento-core/src/domains/telemetry/usage/usage-vocabulary.ts` 한 곳에 둔다. 마이그레이션의 `CHECK` 와 앱의 정규화 함수가 이 목록을 함께 쓴다. 두 쪽이 같은지는 테스트가 본다(마이그레이션이 만든 표에 목록 밖 값을 넣으면 거부되는지).

### 마이그레이션

- 번호는 **069**(066~068 확인). 이름 `usage-daily-count`.
- `CREATE TABLE IF NOT EXISTS usage_daily_count (...) WITHOUT ROWID` 만 쓴다. 기존 243MB 데이터를 건드리지 않고 순식간에 끝난다. 옛 바이너리는 새 표를 무시한다.
- `schema.sql` 에도 같은 표를 더한다. 새로 설치하는 DB 는 `schema.sql` 로 만들기 때문이다(`telemetry_daily_metrics` 가 `schema.sql:467` 과 028 마이그레이션에 둘 다 있는 것과 같다).
- `down()` 은 028 처럼 `DROP TABLE IF EXISTS usage_daily_count` 와 `memento_schema_version` 의 해당 버전 행 삭제를 한다.
- **되돌리는 길:** `down()` 을 실행하거나 표를 지운다. 코드는 flush 실패를 삼키므로 표가 없어도 서버는 동작한다(집계만 남지 않는다).

### 보관

- `telemetry-cleanup-batch-job.ts` 는 `execute` 전체가 한 `try` 라서, 집계 삭제를 같은 `try` 에 넣으면 집계 표가 없을 때 기존 90일 텔레메트리 정리가 실패로 기록된다. **집계 삭제는 별도 `try/catch` 로 분리한다.** 365일 지난 행을 지우고, 실패하면 경고 한 줄만 남기고 기존 정리는 영향을 받지 않는다. 상수이고 설정 키는 없다.
- 행 수 추정: 결정 5 의 상한 때문에 하루 2,000행 이하, 1년 73만 행 이하다. 실제로는 쓰는 조합만 생겨 훨씬 적다(추정).

### 보는 곳

- 화면은 만들지 않는다.
- #1769 `memento doctor --report` 가 최근 7일을 읽어 보고서에 넣는다.
- 그 전까지는 `sqlite3` 로 직접 본다. 운영 문서(`docs/operations/ko/`)에 질의 두 개를 적는다(접속 방식 × 시대 × 클라이언트, 도구 × 오류 코드).

### 무엇이 들어가지 않는가

| 들어가지 않는 것 | 막는 방법 | 막는 힘 |
|---|---|---|
| 기억 내용, 검색어, 도구 인자, 응답 | 집계 함수가 인자와 결과를 받지 않는다. 시그니처가 `(key: UsageCountKey)` 뿐이다 | 시그니처. 가장 강하다 |
| 파일 경로, 토큰, 프로젝트/owner/agent/세션 ID | 같은 이유 + `client_name`/`connection_method` 등 `CHECK IN` | 시그니처 + DB |
| 오류 메시지와 스택 | `error_code` 만 남긴다 | 시그니처 + DB |
| 클라이언트가 보낸 임의 문자열 | 이름은 목록 또는 `other`, 버전은 세 조각 숫자 | 앱 정규화 + DB |
| `tool` 칸의 모양이 맞는 임의 문자열 | 앱 정규화(등록 도구 아니면 `other`) | **앱 정규화와 테스트 1 뿐.** DB 모양 제약은 `/`, 공백, 대문자만 막는다 |

`audit_log.tool_or_endpoint` 에는 세션 ID 가 경로째 들어간다(운영 예: `/api/v1/agent/sessions/<uuid>:pre-compact`). `http-audit.middleware.ts` 의 `extractRoute` 가 원시 경로를 쓰기 때문이다. 이 집계는 `audit_log` 를 읽지 않으므로 옮겨 오지 않는다. 원본 쪽을 경로 템플릿으로 바꾸는 일은 별도 이슈로 제안한다(만들지 않음, 아래 「후속 제안」).

## 테스트 (구현 PR 수용 기준)

1. **새어 나가지 않음.** 기억 내용, 검색어, 경로(`/home/...`), 토큰 모양 문자열, 프로젝트와 세션 ID 를 인자, 클라이언트 이름, 버전, 도구 이름에 넣고 호출한다. 그 뒤 `usage_daily_count` 의 모든 칸을 이어 붙인 문자열에 그 값이 하나도 없는지 본다.
2. **DB 제약.** 목록 밖 접속 방식, 시대, 오류 코드, 클라이언트 이름, **모양은 맞지만 목록 밖인 값(`client_name = 'zzz'`)** 을 SQL 로 직접 넣으면 거부된다. 모양 밖 버전과 `tool` 이름도 거부된다. 반대로 `tool` 칸은 모양이 맞는 임의 소문자 단어를 DB 가 받아들임을 명시적으로 확인하는 테스트(`tool` 의 마지막 방어선이 앱 정규화임을 고정하는 테스트)를 둔다.
3. **새 방식 클라이언트.** `_meta` 에 `io.modelcontextprotocol/clientInfo` 를 실은 HTTP `tools/call` 이 그 이름과 버전, `http-streamable`, `modern` 으로 남는다. 실측값(`claude-code`, `2.1.327`)으로 픽스처를 만든다. 키가 없으면 `unknown` 이다.
4. **옛 방식 HTTP.** `initialize` 뒤 같은 `mcp-session-id` 의 `tools/call` 이 `initialize` 의 클라이언트로 남는다. 픽스처는 실측값(`Cursor` → `cursor`, `1.0.0`)을 쓴다. 세션 헤더가 없으면 `unknown` 이다. 128자를 넘는 세션 키는 기억하지 않는다. 1,000개를 넘으면 가장 오래 안 쓴 것이 밀려나고, 읽은 세션은 밀려나지 않는다(LRU).
5. **SSE, stdio 양쪽 시대.** 각 경로에서 한 건씩 접속 방식과 시대가 맞게 남는다.
6. **실패.** 잘못된 인자 호출이 `error`, `-32602` 로 남는다. **`executionStarted` 가 `true` 가 되기 전에 던지는 오류(토큰 묶임 위반)도 남는다.**
7. **메모리 모으기와 flush.** 같은 열쇠를 여러 번 세면 flush 때 한 번의 UPSERT 로 `count + excluded.count` 가 된다. 두 `Map`(두 프로세스를 흉내)이 같은 DB 에 flush 하면 합쳐진다. 종료 훅이 마지막 `Map` 을 비운다. flush 실패(표 없음)가 도구 호출을 막지 않는다.
8. **행 수 상한.** 하루 2,000개 열쇠에 닿은 뒤 새 버전은 `''` 으로, 그래도 새 열쇠면 `other` 로 합쳐진다. `other`/`unknown` 이름은 버전이 `''` 이다. 접미사는 버려진다.
9. **보관.** 366일 전 행은 정리 잡 뒤 없다. 집계 표가 없어도 기존 90일 텔레메트리 정리는 성공으로 기록된다.
10. **네트워크 없음.** 바뀐 파일에 `fetch`, `http.request`, 외부 URL 이 새로 생기지 않는다. 리뷰에서 diff 로 본다.

## 문서 동반 수정 (구현 PR)

- `GLOSSARY.md` 「운영」 절(위 용어 넷).
- `docs/operations/ko/` 에 집계 질의 두 개, 보관 365일, 행 수 상한 2,000.
- `docs/agents/architecture.md` 텔레메트리 절에 집계 표 한 줄.
- `CHANGELOG.md` Unreleased Added.
- README 는 고치지 않는다. 사용자에게 보이는 기능이 아니고 #1769 가 README 를 고친다.

## 버린 안 정리

| 버린 안 | 비용 |
|---|---|
| HTTP 응답 상태를 집계에 넣는다 | 이미 `http-audit.jsonl` 에 상태가 있어 같은 숫자를 두 곳에 둔다 |
| 감사 기록 `transport` 값에 `mcp_http_sse` 를 더한다 | 감사 표 `CHECK` 와 해시 체인 입력이 바뀐다. 집계만 나누면 충분하다 |
| 클라이언트 이름을 정규화한 원문 그대로 저장한다 | 새 클라이언트를 바로 알 수 있다. 하지만 클라이언트가 보내는 임의 문자열이 표에 들어간다. 이슈의 「알려진 목록 아니면 other」와도 어긋난다 |
| 세는 곳을 접속 방식마다(다섯 진입점) 둔다 | 도구 호출을 세는 코드가 다섯 벌이 된다. `dispatchTool` 한 곳이면 된다 |
| 프로토콜 단계 거부(-32020/-32021/-32022)를 센다 | `dispatchTool` 앞 HTTP 계층에서 나와 세는 곳이 따로 필요하다. #1774 는 `era='legacy'` 횟수로 충분하다 |
| 호출마다 UPSERT | 경합 때 호출 쪽 이벤트 루프가 최대 60초 멈출 수 있다(결정 4) |

## 후속 제안 (이슈는 만들지 않는다)

- `http-audit.middleware.ts` `extractRoute` 가 원시 경로 대신 라우트 템플릿(`/api/v1/agent/sessions/:id:pre-compact`)을 남긴다. 그러면 감사 기록의 `tool_or_endpoint` 에 세션 ID 가 들어가지 않는다. 운영 30일에 이런 행이 수십 개였다.
- `/mcp` 401 932줄(운영 http-audit, 2026-09-05 부터)은 인증 실패다. 어느 클라이언트인지 이 집계로는 모른다(인증 전이라 집계를 지나지 않는다). 필요하면 따로 본다.

## 읽어서 메운 미지

| 물음 | 답 | 근거 |
|---|---|---|
| `/mcp` 6% 실패가 무엇인가 | 405 가 약 80%, 서버 오류(500)는 3줄. 출처마다 분모가 다르다(6% 대 9.0%) | 「숫자 정정」 절 |
| 도구 호출이 모두 한 곳을 지나는가 | 그렇다. stdio, HTTP, WebSocket, REST 모두 `dispatchTool` | `audit-tool-dispatch.ts` 끝 주석, `http-server-websocket.ts:161`, `tools.routes.ts:67`, `api.routes.ts:98` |
| 도구 실패는 결과(`isError`)인가 예외인가 | 예외다. `mapToolDispatchError` 가 JSON-RPC 코드로 바꾼다 | `audit-tool-dispatch.ts`, 서버 코드에 `isError: true` 없음 |
| 새 방식 클라이언트 정보가 실제로 오는가 | **온다.** Claude Code 2.1.327 이 모든 요청에 보낸다 | 로컬 탐침 (2026-11-18) |
| 옛 방식 클라이언트가 세션 헤더를 다시 보내는가 | **보낸다.** opencode 1.19.6, cursor-agent 2026.11.17 둘 다 | 로컬 탐침 (2026-11-18) |
| cursor-agent 가 보내는 이름과 버전 | `Cursor` / `1.0.0` (도구 버전과 무관) | 로컬 탐침 (2026-11-18) |
| SDK v2 에서 새 방식 클라이언트 정보를 어디서 읽나 | `ServerContext.mcpReq.envelope`, 상수 `CLIENT_INFO_META_KEY` | `@modelcontextprotocol/server` 2.3.1 타입 선언 |
| 옛 방식 stdio 는 | `Server.getClientVersion()` | 같은 타입 선언 |
| 쓰기 잠금 경합 때 대기 한도 | 60,000ms | `init-sqlite-session.ts:31` |
| 기본 도구 노출 목록 | `core` 네 개만(`recall`, `remember`, `memory_injection`, `feedback`) | `tools/index.ts:79`, 기본 `MEMENTO_TOOLSET=core` |

## 남은 모르는 것

- codex, gemini-cli, vscode, zed, windsurf, cline, mcp-inspector 의 실제 `clientInfo.name` 원문(이 환경에 없다). 구현 PR 에서 확인해 목록을 정하고, 못 정한 이름은 `other` 로 센다.
- 경합 중 집계 쓰기 지연. 메모리 모으기를 골라 호출 경로에는 쓰기가 없으므로 측정이 필요 없지만, flush 한 번이 다른 프로세스의 잠금을 기다리는 시간은 재지 않았다(30초에 한 번이라 영향이 작다고 추정).
- 하루 열쇠 상한 2,000 의 근거는 어림이다. 한도에 닿은 날의 로그를 보고 조정한다.

## 설계 리뷰 지적 반영표 (머슴5, 2026-11-18)

| # | 구분 | 지적 | 판정 | 반영한 곳 / 이유 |
|---|---|---|---|---|
| 1 | 차단 | `CHECK` 가 문서가 말한 만큼 막지 못한다 (`client_version`, `client_name`, `tool`) | 반영 | 결정 1 에 칸마다 막는 것과 통과하는 것을 표로 적고, `client_version` 모양 `CHECK`, `client_name` 을 `CHECK IN` 으로 올렸다. `tool` 의 마지막 방어선이 앱 정규화와 테스트 1 임을 사실대로 썼다. 테스트 2 에 모양은 맞지만 목록 밖인 값을 넣었다 |
| 2 | 차단 | 행 수가 클라이언트 입력에 따라 무한히 는다 | 반영 | 결정 5 와 결정 2 의 버전 정규화. 접미사 버림, `other`/`unknown` 이면 버전 빈 값, 하루 열쇠 2,000개 상한과 합치기, 경고 로그. 테스트 8 |
| 3 | 차단 | 「요청 처리 시간을 늘리지 않는다」가 성립하지 않는다 (`busy_timeout` 60초, 동기 쓰기) | 반영 | `init-sqlite-session.ts:31` 로 60,000ms 를 확인했다. 결정 4 를 메모리 `Map` 에 모아 30초마다와 종료 때 한 트랜잭션으로 쓰는 쪽으로 바꿨다. 이전 판의 「다중 프로세스 처리가 더 든다」는 근거가 틀렸음을 인정하고 `count + excluded.count` 로 합쳐짐을 적었다. 테스트 7 |
| 4 | 차단 | 세는 지점과 오류 코드 목록이 어긋난다 (HTTP 계층에서 나는 코드, `executionStarted` 전 오류) | 반영 | 결정 3. 세는 지점을 `createToolDispatcher` 바깥 래퍼로 옮겨 `executionStarted` 와 무관하게 센다. 프로토콜 단계 거부(`-32020/-32021/-32022`, 요청 단계의 `-32700/-32600/-32601`)는 세지 않기로 하고 목록에서 뺐다(단 `dispatchTool` 안의 `Unknown tool:` 이 만드는 `-32601` 은 센다)(#1774 는 `era='legacy'` 횟수로 충분). 테스트 6 에 `executionStarted` 전 오류를 넣었다 |
| 5 | 차단 | 핵심 미지(새 방식 `clientInfo` 실재, 옛 방식 세션 헤더 재전송)가 「남은 모르는 것」에 빠졌다 | 반영 (실측으로 풂) | 문서를 고치기 전에 로컬 탐침으로 세 클라이언트를 직접 붙였다. 새 방식은 `_meta` 로 오고(Claude Code), 옛 방식 둘은 세션 헤더를 다시 보낸다. 결과를 「확인한 것」 절에 표로 넣고, 리뷰가 제안한 API 키 ID 대비안은 실측으로 필요 없어 두지 않았다(이유 적음). cursor-agent 의 이름 `Cursor` 와 버전 `1.0.0`(도구 버전과 무관)이라는 새 사실이 나와 정규화에 소문자 변환을 더했다 |
| 6 | 비차단 | 옛 방식 세션 기억 상한이 항목 크기를 보지 않는다 | 반영 | 결정 2. 키 128자 상한(초과하면 기억하지 않음), 값은 정규화한 (이름, 버전) 쌍만, 읽을 때 최근 사용으로 갱신하는 LRU. 테스트 4 |
| 7 | 비차단 | `client_name_unrecognized` 로그의 Set 도 상한이 필요하다 | 반영 | 결정 2. 32개 상한, 넘으면 더 남기지 않는다. 로그 줄은 둔다(없으면 `other` 에 묻힌 새 클라이언트를 못 본다). 값은 영숫자와 `.-_` 40자로 남겼으나 2차 리뷰(아래)에서 더 좁혔다 |
| 8 | 비차단 | 마이그레이션에서 빠진 것 | 반영 | 「마이그레이션」 절. 번호 069(066~068 확인), `schema.sql` 동기화, `down()` 의 `DROP TABLE IF EXISTS` 와 버전 행 삭제, 되돌리는 길, `WITHOUT ROWID`, `outcome`/`error_code` 짝 `CHECK`. 정리 잡의 집계 삭제를 별도 `try/catch` 로 분리(보관 절, 테스트 9) |
| 9 | 비차단 | 숫자 출처와 `tool` 정규화 기준 두 곳 | 반영 | 「숫자 정정」 절에 6%(`audit_log`, 최근 30일)와 9.0%(`http-audit.jsonl`, 2026-09-05 부터)를 분모와 함께 나란히 적었다. `tool` 정규화 기준을 `getAllTools()` 로 바꾸고 이유(기본 `core` 가 네 개뿐이라 REST/WebSocket 도구가 `other` 로 합쳐짐)를 결정 1 에 적었다 |

### 2차 리뷰 (머슴5, 승인, 작은 지적 3건)

| # | 지적 | 판정 | 반영한 곳 / 이유 |
|---|---|---|---|
| 1 | 로그에 클라이언트가 보낸 이름이 최대 40자로 남는다. 토큰 모양 문자열을 이름 칸에 넣으면 그대로 남는다 | 반영 | 영문자와 하이픈만 있는 20자 이하일 때만 이름을 남기고 그 밖은 이름 없이 길이만 한 번 남긴다(결정 2 「이름 정규화」). 테스트: `usage-recording.spec.ts`, `usage-vocabulary.spec.ts` |
| 2 | 누출 테스트의 도구 이름이 하이픈 때문에 모양 검사에서 걸러져 `registered.has` 확인을 시험하지 못한다 | 반영 | 모양은 맞지만 등록 안 된 이름 셋(`secretproject`, 16진 토큰, `memento`)을 더했다. `registered.has` 를 빼면 이 케이스가 실패하는 것을 확인했다 |
| 3 | `day` 칸 CHECK 가 길이 10 만 본다 | 그대로 둠(요청) | 쓰는 쪽이 `toISOString().slice(0,10)` 하나뿐이라 실제 위험이 없고 칸별 표에 이미 적혀 있다 |

**반영하지 않은 지적은 없다.** 다만 지적 5의 제안 일부(API 키 ID 에 묶는 대비안)는 실측으로 필요가 없어 두지 않았고 이유를 위 표와 결정 2 의 버린 안에 적었다.
