# GEMINI.md

이 저장소는 AI 에이전트를 위한 통합 가이드 시스템을 따릅니다.

**중요: 프로젝트 개요, 아키텍처, 명령어, 개발 워크플로우에 대한 마스터 가이드는 [AGENTS.md](./AGENTS.md)를 참조하십시오.**

## 빠른 참조 (Quick Reference)
- **마스터 가이드**: [AGENTS.md](./AGENTS.md)
- **아키텍처**: npm workspaces (@memento/core, memento-server, @memento/client)
- **핵심 명령어**: `npm install`, `npm run build`, `npm run dev`, `npm test`
- **MCP 사용**: 작업 전 `recall`/`memory_injection` 조회, 작업 후 `remember` 저장.
- **graphify**: 코드 수정 후 지식 그래프 재빌드 명령 실행 필수.
