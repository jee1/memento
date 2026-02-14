# Phase 7.5: 에러 처리 패턴 중복 위치 분석

## 분석 목적
에러 처리 패턴의 중복 위치를 파악하여 공통 에러 핸들러 함수로 통일

## 분석 결과

### 1. 주요 에러 처리 패턴

#### 패턴 1: errorLoggingService.logError 패턴
**위치**: 서버 진입점 및 라우트 핸들러
**파일**:
- `src/server/index.ts` (440-458줄)
- `src/server/routes/admin.routes.ts` (여러 곳)
- `src/server/routes/mcp.routes.ts` (여러 곳)

**패턴 구조**:
```typescript
try {
  // 작업 수행
} catch (error) {
  // 에러 로깅
  if (errorLoggingService) {
    errorLoggingService.logError(
      error instanceof Error ? error : new Error(String(error)),
      ErrorSeverity.HIGH,
      ErrorCategory.UNKNOWN,
      {
        operation: 'operation_name',
        // 추가 컨텍스트
      }
    );
  }
  
  // 에러 변환 및 재throw
  if (error instanceof Error) {
    throw new Error(`Operation failed: ${error.message}`);
  }
  throw error;
}
```

**중복 횟수**: 약 10-15곳

#### 패턴 2: this.logError + handleFailure 패턴
**위치**: BaseTool 상속 클래스
**파일**:
- `src/domains/memory/tools/recall-tool.ts` (894-918줄)
- `src/domains/memory/tools/remember-tool.ts` (여러 곳)
- `src/domains/memory/tools/forget-tool.ts` (여러 곳)
- 기타 BaseTool 상속 클래스들

**패턴 구조**:
```typescript
try {
  // 작업 수행
} catch (error) {
  this.logError(error as Error, 'Operation failed', { params });
  
  // 실패 감지 훅 호출
  const executionTime = Date.now() - startTime;
  await this.handleFailure(
    error instanceof Error ? error : new Error(String(error)),
    params,
    context,
    executionTime
  );
  
  // 사용자 친화적인 에러 메시지 반환
  if (error instanceof Error) {
    if (error.message.includes('validation')) {
      throw new Error(`입력 검증 실패: ${error.message}`);
    } else if (error.message.includes('database')) {
      throw new Error(`데이터베이스 오류: ${error.message}`);
    }
  }
  
  throw error;
}
```

**중복 횟수**: 약 20-30곳 (모든 BaseTool 상속 클래스)

#### 패턴 3: logger.error/warn 패턴
**위치**: 일반적인 에러 로깅
**파일**:
- `src/server/http-server.ts` (여러 곳)
- `src/server/routes/tools.routes.ts` (여러 곳)
- `src/tools/tool-registry.ts` (140-148줄)
- 기타 여러 파일

**패턴 구조**:
```typescript
try {
  // 작업 수행
} catch (error) {
  logger.error('Operation failed', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    // 추가 컨텍스트
  });
  throw error;
}
```

**중복 횟수**: 약 50-70곳

#### 패턴 4: 에러 변환 패턴
**위치**: 여러 곳
**패턴 구조**:
```typescript
catch (error) {
  // 에러 타입에 따른 변환
  if (error instanceof Error) {
    if (error.message.includes('validation')) {
      throw new Error(`입력 검증 실패: ${error.message}`);
    } else if (error.message.includes('database')) {
      throw new Error(`데이터베이스 오류: ${error.message}`);
    }
  }
  throw error;
}
```

**중복 횟수**: 약 15-20곳

### 2. 공통 패턴 분석

#### 공통 요소
1. **에러 타입 체크**: `error instanceof Error ? error : new Error(String(error))`
2. **에러 로깅**: 다양한 방식 (errorLoggingService, this.logError, logger.error)
3. **에러 변환**: 사용자 친화적인 메시지로 변환
4. **에러 재throw**: 원본 에러 또는 변환된 에러를 재throw

#### 차이점
1. **로깅 방식**: errorLoggingService vs this.logError vs logger.error
2. **컨텍스트 정보**: 각 패턴마다 다른 컨텍스트 정보 포함
3. **에러 변환 로직**: 일부는 변환, 일부는 그대로 재throw

### 3. 문제점
1. **중복 코드**: 동일한 에러 처리 로직이 100곳 이상에 반복
2. **일관성 부족**: 각 파일마다 다른 에러 처리 방식 사용
3. **유지보수 어려움**: 에러 처리 로직 변경 시 여러 곳 수정 필요
4. **테스트 어려움**: 에러 처리 로직이 분산되어 있어 테스트 작성 어려움

### 4. 해결 방안
1. **공통 에러 핸들러 함수 생성**: `withErrorHandling` 함수
2. **에러 변환 로직 통일**: 공통 에러 변환 함수
3. **로깅 방식 통일**: errorLoggingService 사용 권장
4. **컨텍스트 정보 표준화**: 공통 컨텍스트 인터페이스 정의

### 5. 우선순위
1. **높음**: BaseTool 상속 클래스의 에러 처리 패턴 통일 (패턴 2)
2. **중간**: 서버 진입점의 에러 처리 패턴 통일 (패턴 1)
3. **낮음**: 일반적인 에러 로깅 패턴 통일 (패턴 3)

## 다음 단계
- [ ] 7.6: withErrorHandling 공통 에러 핸들러 함수 정의 및 테스트 작성
- [ ] 7.7: withErrorHandling 공통 에러 핸들러 함수 구현
- [ ] 7.8: 모든 에러 처리 패턴을 공통 핸들러로 교체
