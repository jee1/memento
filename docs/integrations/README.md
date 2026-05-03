# Memento × External AI Assistants

이 디렉터리는 **이미 존재하는 단일-사용자 개인 AI 비서**가 Memento를 공유 장기 기억 백엔드로 사용하도록 안내합니다. 새 비서를 만들지 않고, 기존 비서에 memento를 *그냥 또 하나의 MCP 서버*로 등록하는 방식입니다.

## 어떤 비서를 쓰시나요?

- [OpenClaw](./openclaw.md) — Node.js 게이트웨이 + 멀티채널
- [NanoClaw](./nanoclaw.md) — 컨테이너 격리 + Claude Agent SDK
- [ZeroClaw](./zeroclaw.md) — Rust 단일 바이너리

## 트랙 결정

- 단일 머신만 사용 → [stdio 트랙](./_shared/transports.md#stdio-트랙) (5분 셋업)
- 여러 디바이스/홈서버 → [HTTP 트랙](./_shared/transports.md#http-트랙) (멀티 디바이스 기억 공유)

## 공통 가이드

- [Transport 결정 + 셋업](./_shared/transports.md)
- [인증 / 토큰 관리](./_shared/auth.md)
- [권장 시스템 프롬프트 패턴](./_shared/system-prompt.md)
- [트러블슈팅](./_shared/troubleshooting.md)

## 더 깊은 통합 (옵션)

베어 MCP만으로 부족하면 `@memento/assistant` SDK를 사용해 *결정론적 자동 회상/저장*을 얻을 수 있습니다.

- **빠른 시작**: [`_shared/sdk-quickstart.md`](./_shared/sdk-quickstart.md)
- Node.js / TypeScript 비서에서 두 개의 훅(`beforeUserTurn` / `afterAssistantTurn`)만 붙이면 됩니다.
- ZeroClaw(Rust)는 Node.js SDK를 직접 사용할 수 없으며, 베어 MCP + 시스템 프롬프트 패턴을 권장합니다.
