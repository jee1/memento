# Memento Dashboard Design System

이 문서는 Memento 관리 대시보드와 그래프 뷰에 적용된 디자인 시스템(토큰 및 컴포넌트 규약)을 설명합니다.

## 설계 원칙
1. **토큰 중심**: 모든 색상, 간격, 라운딩 값은 직접 사용하지 않고 CSS 변수(Tokens)를 통해 참조합니다.
2. **점진적 전환**: 기존 UI 구조를 파지하지 않으면서 스타일만 규약에 맞게 정리합니다.
3. **가벼운 구조**: 외부 프레임워크 없이 순수 CSS Custom Properties만으로 테마와 일관성을 관리합니다.

## 디자인 토큰 (`static/css/tokens.css`)

### 주요 색상 (Colors)
| 토큰명 | 값 | 용도 |
|:---|:---|:---|
| `--color-brand-primary` | `#667eea` | 주요 브랜드 컬러 (버튼 등) |
| `--color-success` | `#10b981` | 성공, Semantic Positive |
| `--color-error` | `#ef4444` | 오류, Semantic Negative |
| `--color-anchor-a` | `#ef4444` | 앵커 슬롯 A |
| `--color-bg-main` | `#f5f5f5` | 메인 대시보드 배경 |
| `--color-bg-graph` | `#0f1117` | 그래프 뷰 배경 (Dark) |

### 간격 및 라운딩 (Spacing & Radius)
- **Spacing**: `--spacing-xs`(4px) ~ `--spacing-xl`(32px)
- **Radius**: `--radius-sm`(4px), `--radius-md`(6px), `--radius-lg`(10px)

## 공통 컴포넌트 규약 (`static/css/components.css`)

새로운 UI 요소를 추가할 때는 아래 클래스를 조합하여 사용합니다.

### 버튼 (Buttons)
- `.m-button`: 기본 버튼 스타일
- `.m-button-primary`: 강조 버튼
- `.m-button-secondary`: 보조 버튼 (투명도 포함)
- `.m-button-ghost`: 테두리만 있는 버튼

### 입력창 (Inputs)
- `.m-input`: 표준 입력창 및 셀렉트 박스 스타일

### 카드 및 컨테이너 (Cards)
- `.m-card`: 그림자와 배경이 포함된 기본 카드

## 상태 규칙
- **Hover**: `:hover` 시 배경색 변경 또는 투명도 조절
- **Disabled**: `opacity: 0.6`, `cursor: not-allowed`
- **Focus**: `--color-border-focus`를 통한 가시적인 테두리 강조

## 가이드라인
- **새 스타일 추가 시**: `tokens.css`에 정의된 변수를 우선적으로 사용하세요.
- **색상 리터럴 금지**: CSS 파일 내에 `#ffffff` 등의 값을 직접 쓰는 대신 토큰을 사용하세요.
- **다크/라이트 경계**: 대시보드는 라이트, 그래프는 다크가 기본입니다. 전용 토큰(`--color-bg-graph` 등)을 활용하세요.
