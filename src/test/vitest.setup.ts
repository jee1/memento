/* eslint-disable no-console */
/**
 * Vitest 전역 설정 파일
 * 네이티브 모듈 모킹 및 공통 테스트 설정
 */

import { vi } from 'vitest';

// @xenova/transformers 모킹 (onnxruntime-node 로딩 방지)
// 모든 테스트에서 일관되게 모킹되도록 전역 설정
vi.mock('@xenova/transformers', () => {
  return {
    pipeline: vi.fn().mockResolvedValue({
      __call: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    }),
    env: {
      useBrowserCache: false,
      useCustomCache: false
    }
  };
});

// onnxruntime-node 모킹 (네이티브 바인딩 로딩 실패 방지)
// @xenova/transformers가 default export를 기대하므로 default도 포함
vi.mock('onnxruntime-node', () => {
  const mockInferenceSession = vi.fn().mockImplementation(() => ({
    load: vi.fn(),
    run: vi.fn(),
    inputNames: [],
    outputNames: []
  }));
  
  const mockTensor = vi.fn().mockImplementation((type, data, dims) => ({
    type,
    data,
    dims
  }));

  return {
    default: {
      InferenceSession: mockInferenceSession,
      Tensor: mockTensor
    },
    InferenceSession: mockInferenceSession,
    Tensor: mockTensor
  };
});

// sharp 모킹 (이미지 처리 라이브러리 로딩 실패 방지)
vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    resize: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-image-data')),
    toFile: vi.fn().mockResolvedValue({})
  }))
}));

// CI/CD 통합을 위한 품질 측정 테스트 훅 (PRD FR-5.9)
// CI 환경에서만 로드하여 테스트 성능에 영향 없도록 함
if (process.env.CI) {
  // 동적 import를 사용하여 CI 환경에서만 로드
  import('./quality-measurement-hook.js').catch(error => {
    console.error('CI 품질 측정 훅 로드 실패:', error);
  });
}

