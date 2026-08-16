# 사용자 매뉴얼

Memento는 AI 에이전트가 대화와 작업 사이에서 정보를 기억하고 검색할 수 있도록 설계된 MCP(Model Context Protocol) 서버입니다. 에이전트는 중요한 결정, 기술 지식, 진행 중인 작업 컨텍스트를 Memento에 저장해 두고, 이후 세션에서 `recall`이나 `memory_injection`으로 불러와 연속성 있는 작업을 이어갈 수 있습니다.

이 매뉴얼은 Memento를 처음 설치하는 사용자부터 HTTP 클라이언트로 통합하는 개발자까지 모두를 대상으로 합니다. 아래 **시작하기**에서 설치와 MCP 연결을 마친 뒤, 이후 절에서 기억 타입·도구·대시보드를 순서대로 익히면 됩니다.

## 시작하기

로컬에서 소스로 돌리려면 저장소를 클론한 뒤 의존성을 설치하고 빌드합니다.

```bash
git clone https://github.com/jee1/memento.git
cd memento

npm install

# 환경 변수 파일 생성 (선택사항 — 기본값으로도 동작합니다)
cp env.example .env

# 데이터베이스 초기화
npm run db:init

# MCP stdio 서버 시작 (핫 리로드)
npm run dev
```

Docker를 선호하는 경우, 컨테이너를 먼저 시작한 뒤 서버 상태를 확인합니다.

```bash
docker-compose up -d
curl http://localhost:9001/health
```

### MCP 클라이언트 연결

#### Claude Desktop

Claude Desktop 설정 파일을 열어 Memento 서버를 추가합니다.

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memento": {
      "command": "node",
      "args": ["path/to/memento/packages/memento-server/dist/server/index.js"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

설정 후 Claude Desktop을 재시작하면 Memento MCP 도구가 활성화됩니다.

#### Cursor

Cursor에서는 **stdio MCP** 방식으로 연결합니다. `packages/memento-server/dist/server/index.js`를 진입점으로 지정하는 방법이며, URL 방식과 혼동하지 않도록 주의하세요.

먼저 프로젝트 루트에서 `npm install && npm run build`로 빌드 산출물을 생성한 뒤, `.cursor/mcp.json`에 `command`와 `args`를 지정합니다. 상세 설정 예시와 오류 대응은 [Cursor MCP 설정 가이드](./cursor-mcp-setup.md)를 참고하세요.

HTTP 서버를 별도로 실행한 경우에는 클라이언트가 지원하면 `http://127.0.0.1:<포트>/mcp` 방식으로도 연결할 수 있습니다. 기본 권장 방식은 stdio입니다.

## 기억 저장하기

AI 에이전트와의 대화에서 중요한 정보를 기억으로 저장하는 가장 간단한 방법은 MCP의 `remember` 도구를 호출하는 것입니다. HTTP 서버가 실행 중일 때는 `@jee1/memento-client` 패키지로도 동일하게 저장할 수 있습니다.

HTTP 서버는 기본적으로 `http://localhost:9001`에서 실행됩니다(`MCP_SERVER_PORT` 또는 `PORT` 환경 변수로 변경 가능). 개발 중에는 `npm run dev:http`로 시작할 수 있습니다.

```typescript
import { MementoClient } from '@jee1/memento-client';

const client = new MementoClient({
  serverUrl: 'http://localhost:9001',
});

await client.connect();

// 기본 저장
await client.remember({
  content: '사용자가 React Hook에 대해 질문했고, useState와 useEffect의 차이점을 설명했다.',
});

// 태그와 중요도를 함께 저장
await client.remember({
  content: '프로젝트에서 TypeScript를 도입하기로 결정했다.',
  tags: ['typescript', 'decision', 'project'],
  importance: 0.8,
});

// 기억 타입을 명시해 저장
await client.remember({
  content: 'React Hook 사용법 요약',
  type: 'semantic',
  tags: ['react', 'hooks', 'programming'],
});
```

CLI를 선호하는 경우에도 동일하게 저장할 수 있습니다.

```bash
memento remember "React Hook 사용법" --type semantic --tags "react,hooks,programming"
```

CLI 사용법 전반은 [Memento CLI for AI 가이드](./memento-cli-for-ai.md)를 참고하세요.

## 기억 타입 이해하기

Memento는 저장 목적에 따라 네 가지 기억 타입을 구분합니다. 타입을 올바르게 지정하면 기억의 수명과 자동 삭제 주기가 결정됩니다.

**작업기억(working)**은 현재 처리 중인 임시 컨텍스트를 위한 것입니다. 48시간이 지나면 자동으로 삭제되므로, 진행 중인 버그 수정 내용이나 임시 메모 등을 저장하기에 적합합니다.

**일화기억(episodic)**은 사건과 경험을 기록합니다. 회의 결정 사항, 작업 완료 기록, 프로젝트 진행 상황 등을 저장하며, 고정(pin)하지 않으면 90일 후 자동 삭제됩니다.

**의미기억(semantic)**은 기술 지식, 가이드라인, 규칙 등 반영구적으로 보존해야 할 지식을 위한 타입입니다. 별도로 삭제하지 않는 한 유지됩니다.

**절차기억(procedural)**은 작업 절차, 배포 방법, 반복적인 문제 해결 과정 등을 저장합니다. 의미기억과 마찬가지로 무기한 보존됩니다.

```bash
# 작업기억 — 짧은 컨텍스트 유지
memento remember "현재 작업 중인 버그 수정 내용" --type working

# 일화기억 — 경험 기록
memento remember "오늘 회의에서 결정된 사항들" --type episodic --tags "meeting,decision"

# 의미기억 — 지식 축적
memento remember "React Hook의 기본 개념과 사용법" --type semantic --tags "react,hooks"

# 절차기억 — 절차 문서화
memento remember "Docker 컨테이너 배포 절차" --type procedural --tags "docker,deployment"
```

## 기억 검색하기

저장된 기억을 찾을 때 Memento는 FTS5 전문 검색과 벡터 유사도 검색을 결합한 하이브리드 검색을 사용합니다. 이 방식 덕분에 키워드가 정확히 일치하지 않아도 의미적으로 관련된 기억을 찾을 수 있습니다.

```typescript
// 기본 하이브리드 검색
const result = await client.hybridSearch({
  query: 'React Hook 사용법',
});

// 벡터 검색 비중을 높여 의미 기반 검색 강화
const tuned = await client.hybridSearch({
  query: 'TypeScript 인터페이스',
  vectorWeight: 0.8,
  textWeight: 0.2,
});
```

CLI에서는 `recall` 명령으로 검색합니다.

```bash
# 기본 검색
memento recall --query "React Hook" --limit 5

# 타입과 태그로 필터링
memento recall --query "TypeScript" --type "episodic,semantic" --tags "programming" --limit 10
```

검색 결과에는 `score`(관련성 점수)와 `recall_reason`(검색된 이유)이 포함되어 어떤 근거로 해당 기억이 반환되었는지 파악할 수 있습니다.

### 임베딩 설정

기본적으로 Memento는 MiniLM 임베딩을 사용합니다. 더 높은 품질의 임베딩이 필요하다면 OpenAI나 Gemini 제공자로 전환할 수 있습니다. `EMBEDDING_PROVIDER` 환경 변수로 제공자를 선택하며, 지원 값은 `tfidf`, `lightweight`, `minilm`, `openai`, `gemini`입니다.

```bash
# .env 파일에 추가
EMBEDDING_PROVIDER=minilm      # 기본값 — API 키 불필요
# EMBEDDING_PROVIDER=openai    # 고품질, API 키 필요
OPENAI_API_KEY=your_key_here
# EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

의미 기반 검색을 활용하면 "자동차"로 검색해도 "차량"이라는 단어가 들어간 기억을 찾을 수 있고, "프로그래밍"으로 검색하면 "코딩"과 관련된 기억도 반환됩니다.

## 기억 관리하기

### 고정과 고정 해제

중요한 기억이 TTL에 의해 자동 삭제되지 않도록 보호하려면 `pin` 도구를 사용합니다.

```bash
memento remember "핵심 아키텍처 결정 사항" --type episodic --tags "architecture,important"
# 반환된 memory_id로 고정
# MCP 도구: pin(memoryId)
```

`@jee1/memento-client`에서는 `client.pin(memoryId)` / `client.unpin(memoryId)`로 고정하고 해제합니다.

### 기억 삭제

기억을 삭제할 때는 소프트 삭제(복구 가능)와 하드 삭제(복구 불가능) 중 선택할 수 있습니다.

```bash
# 소프트 삭제
memento forget --id mem_xxxxx

# 하드 삭제 — 복구 불가
memento forget --id mem_xxxxx --hard --confirm true
```

`@jee1/memento-client`에서는 `client.forget(memoryId, hard)` 형태로 호출합니다.

### 피드백 제공

검색 결과의 유용성에 대한 피드백을 제공하면 이후 검색 품질 개선에 반영됩니다. MCP 도구 `feedback`을 사용하거나 `client.feedback(...)` 메서드를 호출합니다.

## 태그 활용하기

태그는 기억을 구조화하고 필터링하는 핵심 수단입니다. 일관된 태그 체계를 사용하면 관련 기억을 정확하게 찾을 수 있습니다.

권장 태그 분류는 다음과 같습니다.

- **언어/기술**: `javascript`, `typescript`, `react`, `docker`
- **카테고리**: `programming`, `design`, `meeting`, `decision`
- **상태**: `todo`, `in-progress`, `completed`, `blocked`
- **중요도**: `critical`, `important`, `nice-to-have`

여러 프로젝트의 기억을 분리하려면 프로젝트별 태그를 일관되게 붙이는 것이 가장 간단한 방법입니다.

```bash
memento remember "프로젝트 A 아키텍처 결정" --tags "project-a,architecture,decision"
memento recall --query "아키텍처" --tags "project-a"
```

## 관계 그래프

기억들 사이에 관계를 설정하면 관련 기억을 따라가며 더 풍부한 컨텍스트를 얻을 수 있습니다. MCP 도구 `add_relation`을 사용해 두 기억을 연결하고, `get_relations`로 연결된 기억 목록을 확인합니다. `get_memory_neighbors`는 특정 기억에서 연결된 이웃 기억을 함께 조회합니다.

자세한 내용은 [관계 레이블링 가이드](./relation-labeling-guide.md)를 참고하세요.

## 문제 해결

### 서버에 연결할 수 없을 때

MCP 클라이언트가 서버에 연결하지 못하는 경우, 먼저 서버가 실행 중인지 확인합니다. stdio 방식이라면 `node packages/memento-server/dist/server/index.js`를 직접 실행해보고, HTTP 방식이라면 `curl http://localhost:9001/health`로 응답을 확인합니다. 기본 HTTP 포트는 9001이며 `MCP_SERVER_PORT` 환경 변수로 변경할 수 있습니다.

빌드 산출물이 없다면 `npm run build`를 먼저 실행하세요. 빌드 후 `packages/memento-server/dist/server/index.js`가 생성됩니다.

### 검색 결과가 나오지 않을 때

쿼리 키워드를 바꿔보거나 타입/태그 필터를 완화해 재시도합니다. 해당 기억이 실제로 저장되었는지 먼저 확인하는 것도 좋습니다. 임베딩 제공자 설정이 저장 시점과 검색 시점 사이에 변경된 경우 의미 검색 결과가 달라질 수 있습니다.

### 로그 확인

로컬 개발 중에는 `npm run dev` 터미널 출력에서 로그를 확인합니다. 마이그레이션 또는 DB 상태가 의심되면 `npm run db:check-migration`을 실행하세요.

Docker 환경에서는 다음 명령으로 로그를 확인합니다.

```bash
docker-compose logs memento-server
docker-compose ps
```

## FAQ

**기억이 자동으로 삭제되나요?**

타입에 따라 다릅니다. 작업기억은 48시간, 일화기억은 90일 후 자동 삭제됩니다. 의미기억과 절차기억은 삭제하지 않는 한 유지됩니다. `pin`으로 고정한 기억은 타입에 상관없이 자동 삭제되지 않습니다.

**기억을 영구적으로 보존하려면 어떻게 하나요?**

`pin` MCP 도구 또는 `client.pin(memoryId)`로 기억을 고정하면 TTL 삭제에서 제외됩니다.

**검색 정확도를 높이려면 어떻게 해야 하나요?**

구체적인 키워드를 포함한 쿼리를 사용하고, 저장 시 관련 태그를 충분히 붙여두세요. `feedback` 도구로 검색 결과의 유용성을 신호로 전달하면 검색 품질 개선에 도움이 됩니다. 의미 검색 품질을 높이려면 MiniLM 이상의 임베딩 제공자를 사용하는 것이 좋습니다.

**데이터베이스는 어디에 저장되나요?**

기본 위치는 `~/.memento/memory.db`입니다. `DB_PATH` 환경 변수나 `--db-path` 옵션으로 경로를 변경할 수 있습니다. 절대 경로를 사용하는 것을 권장합니다.

## 추가 리소스

- [API 참조 문서](../../api/ko/api-reference.md)
- [개발자 가이드](developer-guide.md)
- [Memento CLI for AI 가이드](./memento-cli-for-ai.md)
- [Cursor MCP 설정 가이드](./cursor-mcp-setup.md)
- [npx 실행 문제 해결](../../operations/ko/npx-troubleshooting.md)
- [Node 버전 호환성](../../operations/ko/troubleshooting-node-version.md)
- [GitHub 저장소](https://github.com/jee1/memento)
