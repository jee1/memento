# npm 패키지 제거 가이드

잘못 올린 `memento-mcp-server` 버전을 npm에서 내리려면 **`npm unpublish`**를 쓰지만, npm 정책상 **게시 후 72시간**과 **다른 패키지의 의존 여부**가 관문입니다. 이 가이드는 특정 버전만 지울 때와 패키지 전체를 지울 때의 명령, 확인 절차, 막혔을 때 대안을 순서대로 설명합니다.

## ⚠️ 중요 제약사항

1. **72시간 규칙**: 패키지가 게시된 지 **72시간 이내**에만 제거 가능합니다.
2. **의존성 확인**: 다른 패키지가 해당 버전을 의존성으로 사용 중이면 제거할 수 없습니다.
3. **영구적 조치**: 72시간 이후에는 npm 지원팀에 직접 문의해야 합니다.

## 📦 특정 버전 제거

특정 버전만 제거하려면:

```bash
npm unpublish <패키지명>@<버전>
```

### 예시

```bash
# memento-mcp-server의 1.6.0 버전 제거
npm unpublish memento-mcp-server@1.6.0

# v 접두사가 있는 경우
npm unpublish memento-mcp-server@1.6.0
```

### 확인 방법

제거 전에 해당 버전이 실제로 존재하는지 확인:

```bash
# 패키지 정보 확인
npm view memento-mcp-server versions

# 특정 버전 정보 확인
npm view memento-mcp-server@1.6.0
```

## 🗑️ 전체 패키지 제거

**⚠️ 매우 신중하게 사용하세요!** 전체 패키지를 제거하려면:

```bash
npm unpublish <패키지명> --force
```

### 예시

```bash
# memento-mcp-server 전체 패키지 제거 (모든 버전)
npm unpublish memento-mcp-server --force
```

### 주의사항

- 다른 패키지가 의존성으로 사용 중이면 제거할 수 없습니다.
- 72시간 이내에만 가능합니다.
- **되돌릴 수 없는 작업**입니다.

## 🔐 인증 필요

npm에 로그인되어 있어야 합니다:

```bash
# 로그인 확인
npm whoami

# 로그인 필요 시
npm login
```

## 📋 제거 절차

### 1. 현재 상태 확인

```bash
# 패키지 정보 확인
npm view memento-mcp-server

# 모든 버전 확인
npm view memento-mcp-server versions --json

# 특정 버전 확인
npm view memento-mcp-server@1.6.0
```

### 2. 의존성 확인

다른 패키지가 사용 중인지 확인:

```bash
# npm 웹사이트에서 확인
# https://www.npmjs.com/package/memento-mcp-server
# "Dependents" 탭에서 확인
```

### 3. 제거 실행

```bash
# 특정 버전 제거
npm unpublish memento-mcp-server@1.6.0

# 확인 메시지가 나오면 'yes' 입력
```

### 4. 확인

```bash
# 제거 확인
npm view memento-mcp-server@1.6.0
# Error: version not found (제거 성공)
```

## 🆘 72시간 이후 제거

72시간이 지난 경우:

1. **npm 지원팀에 문의**: support@npmjs.com
2. **제거 사유 명시**: 보안 문제, 실수로 게시 등
3. **패키지 정보 제공**: 패키지명, 버전, 제거 사유

### 문의 템플릿

```
제목: Package Unpublish Request - memento-mcp-server@1.6.0

내용:
- Package Name: memento-mcp-server
- Version: 1.6.0
- Reason: [제거 사유]
- Published Date: [게시 날짜]
- Request Date: [요청 날짜]
```

## 🔄 대안: Deprecate (비추천 표시)

제거 대신 비추천(deprecate)으로 표시:

```bash
# 특정 버전을 비추천으로 표시
npm deprecate memento-mcp-server@1.6.0 "This version has critical bugs. Please use 1.6.1 or later."

# 모든 버전 비추천
npm deprecate memento-mcp-server "This package is deprecated. Use @memento/mcp-server instead."
```

**장점:**
- 언제든지 가능 (72시간 제한 없음)
- 사용자에게 경고 메시지 표시
- 패키지는 여전히 다운로드 가능

**단점:**
- 패키지가 npm에 남아있음
- 완전히 제거되지 않음

## 📝 체크리스트

제거 전 확인사항:

- [ ] 72시간 이내인가?
- [ ] 다른 패키지가 의존성으로 사용 중이 아닌가?
- [ ] npm에 로그인되어 있는가?
- [ ] 올바른 패키지명과 버전을 입력했는가?
- [ ] 제거 사유가 명확한가?

## 🔗 참고 자료

- [npm unpublish 문서](https://docs.npmjs.com/cli/v10/commands/npm-unpublish)
- [npm deprecate 문서](https://docs.npmjs.com/cli/v10/commands/npm-deprecate)
- [npm 지원팀](https://www.npmjs.com/support)

