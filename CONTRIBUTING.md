# 기여하기 (Contributing)

Memento MCP Server 프로젝트에 기여해주셔서 감사합니다! 이 문서는 프로젝트에 기여하는 방법을 안내합니다.

## 🚀 빠른 시작

### 1. 저장소 포크
1. GitHub에서 [memento 저장소](https://github.com/jee1/memento)를 포크합니다.
2. 포크한 저장소를 로컬에 클론합니다:
   ```bash
   git clone https://github.com/your-username/memento.git
   cd memento
   ```

### 2. 개발 환경 설정
```bash
# 의존성 설치
npm install

# 개발 서버 시작
npm run dev

# 테스트 실행
npm run test
```

## 📋 기여 방법

### 버그 리포트
버그를 발견하셨나요? 다음 정보를 포함하여 이슈를 생성해주세요:
- **버그 설명**: 무엇이 잘못되었는지 명확한 설명
- **재현 단계**: 버그를 재현하는 단계별 방법
- **예상 동작**: 어떻게 동작해야 하는지
- **실제 동작**: 실제로 어떻게 동작하는지
- **환경 정보**: OS, Node.js 버전, 브라우저 등

### 기능 제안
새로운 기능을 제안하고 싶으신가요? 다음을 포함해주세요:
- **기능 설명**: 어떤 기능을 원하는지
- **사용 사례**: 왜 이 기능이 필요한지
- **구현 아이디어**: 어떻게 구현할 수 있을지 (선택사항)

### 코드 기여
코드로 기여하고 싶으신가요? 다음 단계를 따라주세요:

1. **이슈 생성**: 먼저 작업할 내용에 대해 이슈를 생성하세요.
2. **브랜치 생성**: `feature/기능명` 또는 `fix/버그명` 형식으로 브랜치를 생성하세요.
3. **코드 작성**: 변경사항을 구현하세요.
4. **테스트**: 테스트를 작성하고 실행하세요.
5. **커밋**: [Conventional Commits](https://www.conventionalcommits.org/) 형식을 따라 커밋하세요.
6. **PR 생성**: Pull Request를 생성하세요.

**PR 본문 참고:**
- GitHub에서 PR을 만들면 **템플릿**으로 `.github/PULL_REQUEST_TEMPLATE.md`가 사용됩니다.
- 본문 작성 시 참고할 **예시**로 [docs/operations/ko/pr-description-example-npm-workflow.md](docs/operations/ko/pr-description-example-npm-workflow.md)가 있습니다(형식·상세도 참고용).

## 🛠️ 개발 가이드라인

### 코딩 스타일
- **언어**: TypeScript (Node.js ≥ 24)
- **들여쓰기**: 2칸 공백
- **따옴표**: 단일 따옴표 (`'`)
- **세미콜론**: 사용
- **ESLint**: 프로젝트의 ESLint 설정을 따릅니다.

### 커밋 메시지
[Conventional Commits](https://www.conventionalcommits.org/) 형식을 사용합니다:

```
type(scope): description

[optional body]

[optional footer(s)]
```

**타입 예시:**
- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 변경
- `style`: 코드 스타일 변경 (포맷팅, 세미콜론 등)
- `refactor`: 코드 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 빌드 프로세스, 도구 변경

**예시:**
```
feat(search): 하이브리드 검색 엔진 추가
fix(memory): 메모리 누수 문제 해결
docs(readme): 설치 가이드 업데이트
```

### 테스트
- **테스트 프레임워크**: Vitest
- **단위 테스트**: `*.spec.ts` 파일로 작성
- **E2E 테스트**: `src/test/` 디렉토리에 작성
- **테스트 실행**: `npm run test`

### 브랜치 전략
- `main`: 안정적인 릴리스 브랜치
- `feature/*`: 새로운 기능 개발
- `fix/*`: 버그 수정
- `docs/*`: 문서 업데이트
- `chore/*`: 유지보수 작업

## 📁 프로젝트 구조

npm workspaces 모노레포입니다. 도메인·DB·MCP 도구 구현은 **`packages/memento-core`**에, MCP/HTTP 서버는 **`packages/memento-server`**에 있습니다. 루트 `src/`·`tests/`에는 공유 스크립트·시나리오 테스트 등이 있습니다.

```
packages/
├── memento-core/     # @memento/core — 도메인 로직, DB, MCP 도구
├── memento-server/   # MCP stdio + HTTP 서버
└── memento-client/   # @memento/client — 서버 연결 클라이언트
apps/
└── experimental-example/   # in-process 사용 예시
src/                  # 루트 스크립트·일부 테스트·에셋 복사 등
tests/                # 통합 픽스처·통합 테스트
```

자세한 디렉터리 역할은 [AGENTS.md](AGENTS.md)를 참고하세요.

## 🔍 코드 리뷰 프로세스

1. **자동 검사**: CI/CD 파이프라인이 자동으로 실행됩니다.
2. **리뷰 요청**: 최소 1명의 리뷰어가 승인해야 합니다.
3. **피드백 반영**: 리뷰어의 피드백을 반영하여 수정합니다.
4. **병합**: 승인 후 `main` 브랜치에 병합됩니다.

## 🐛 버그 수정

버그를 수정할 때:
1. **재현 테스트**: 버그를 재현하는 테스트를 작성합니다.
2. **수정**: 버그를 수정합니다.
3. **테스트 통과**: 모든 테스트가 통과하는지 확인합니다.
4. **문서 업데이트**: 필요시 관련 문서를 업데이트합니다.

## ✨ 기능 추가

새로운 기능을 추가할 때:
1. **설계 검토**: 기능 설계에 대해 이슈에서 논의합니다.
2. **테스트 작성**: 기능에 대한 테스트를 작성합니다.
3. **구현**: 기능을 구현합니다.
4. **문서 작성**: API 문서와 사용법을 작성합니다.

## 📚 문서화

문서를 업데이트할 때:
- **한국어 우선**: 한국어 문서를 우선으로 작성합니다.
- **영어 번역**: 필요시 영어 문서도 업데이트합니다.
- **예시 포함**: 코드 예시와 사용 사례를 포함합니다.
- **최신 상태 유지**: 코드 변경사항과 동기화합니다.

## 🤝 커뮤니티

- **이슈**: [GitHub Issues](https://github.com/jee1/memento/issues)
- **토론**: [GitHub Discussions](https://github.com/jee1/memento/discussions)
- **문서**: [Wiki](https://github.com/jee1/memento/wiki)

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 기여하시는 코드는 동일한 라이선스 하에 배포됩니다.

## 🙏 감사

모든 기여자분들께 감사드립니다! 여러분의 기여가 Memento를 더 나은 프로젝트로 만들어줍니다.

---

**질문이 있으시면 언제든지 이슈를 생성하거나 토론에 참여해주세요!**
