# Memento Agent Guidelines (진입점)

AI 에이전트·자동화가 이 저장소에서 일할 때 **먼저 읽는 짧은 요약**이다. 구조·명령·스타일·테스트·PR·환경·도구 **전체**는 **[DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)**에만 둔다(중복 없음).

## 필독

| 문서 | 역할 |
|------|------|
| **[DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)** | 개발 규칙 단일 출처(구조, 빌드, 스타일, 테스트, PR·이슈, 환경, MCP/Serena/graphify 전문) |
| [CLAUDE.md](CLAUDE.md) | Claude Code |
| [GEMINI.md](GEMINI.md) | Gemini CLI |

## 품질 게이트

커밋·PR 전: `npm run lint` · `npm run type-check` · `npm test`

## 에이전트 도구 (요약)

상세·예시는 [DEVELOPMENT_RULES.md](DEVELOPMENT_RULES.md)의 **«AI 에이전트 도구»** 절을 본다.

- **Memento MCP**: 작업 전 `recall` / `memory_injection`, 작업 후 `remember`
- **Memento CLI**: [docs/guides/ko/memento-cli-for-ai.md](docs/guides/ko/memento-cli-for-ai.md)
- **Serena**: 심볼 도구 우선, 같은 파일 불필요 반복 읽기 금지
- **graphify**: 아키텍처 질문 전 `graphify-out/GRAPH_REPORT.md`; 코드 수정 후 그래프 재빌드 명령은 DEVELOPMENT_RULES 참고
