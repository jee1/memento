/**
 * Quality Assurance 라우터 단위 테스트
 * 
 * PRD FR-5.4: HTTP API 라우터 단위 테스트 작성
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { createQualityRouter } from './quality.routes.js';
import { QualityAssuranceService, QualityThresholdManager, DatabaseUtils } from '@memento/core';

describe('Quality Routes', () => {
  let db: Database.Database;
  let router: ReturnType<typeof createQualityRouter>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Given: 테스트용 데이터베이스 초기화
    db = new Database(':memory:');
    DatabaseUtils.exec(db, `
      CREATE TABLE IF NOT EXISTS quality_measurement_history (
        id TEXT PRIMARY KEY,
        measurement_type TEXT NOT NULL CHECK (measurement_type IN ('batch', 'test', 'manual')),
        measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        metrics TEXT NOT NULL,
        status TEXT CHECK (status IN ('success', 'warning', 'error')) DEFAULT 'success',
        warnings TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_measured_at 
        ON quality_measurement_history(measured_at);
      CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_type 
        ON quality_measurement_history(measurement_type);
      CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_status 
        ON quality_measurement_history(status);
      CREATE TABLE IF NOT EXISTS quality_metrics (
        metric_namespace TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        context TEXT DEFAULT 'default',
        metric_value REAL NOT NULL,
        measured_at TIMESTAMP NOT NULL,
        status TEXT CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
        threshold_value REAL,
        threshold_type TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (metric_namespace, metric_key, context)
      );
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_namespace_key 
        ON quality_metrics(metric_namespace, metric_key);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_context 
        ON quality_metrics(context);
      CREATE INDEX IF NOT EXISTS idx_quality_metrics_status 
        ON quality_metrics(status);
      CREATE TABLE IF NOT EXISTS quality_thresholds (
        metric_namespace TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        context TEXT DEFAULT 'default',
        threshold_value REAL NOT NULL,
        threshold_type TEXT CHECK (threshold_type IN ('min', 'max')) NOT NULL,
        description TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (metric_namespace, metric_key, context)
      );
    `);

    router = createQualityRouter(db);

    // Mock Express request/response
    mockRequest = {
      query: {},
      params: {},
      body: {}
    };

    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis()
    };

    mockNext = vi.fn();
  });

  afterEach(() => {
    // When: 테스트 종료 후 정리
    db.close();
  });

  describe('GET /api/v1/quality/report', () => {
    it('should generate markdown report by default', async () => {
      // Given: 기본 파라미터로 리포트 요청
      mockRequest.query = {};

      // When: 리포트 생성 요청
      const handler = router.stack.find(layer => layer.route?.path === '/report' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: Markdown 형식으로 리포트 생성
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/markdown');
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should generate json report when format=json', async () => {
      // Given: JSON 형식으로 리포트 요청
      mockRequest.query = { format: 'json' };

      // When: 리포트 생성 요청
      const handler = router.stack.find(layer => layer.route?.path === '/report' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: JSON 형식으로 리포트 생성
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should generate html report when format=html', async () => {
      // Given: HTML 형식으로 리포트 요청
      mockRequest.query = { format: 'html' };

      // When: 리포트 생성 요청
      const handler = router.stack.find(layer => layer.route?.path === '/report' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: HTML 형식으로 리포트 생성
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html');
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should filter by namespace when provided', async () => {
      // Given: 네임스페이스 필터로 리포트 요청
      mockRequest.query = { namespace: 'search' };

      // When: 리포트 생성 요청
      const handler = router.stack.find(layer => layer.route?.path === '/report' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 리포트 생성 성공
      expect(mockResponse.send).toHaveBeenCalled();
    });

    it('should return 500 when service not initialized', async () => {
      // Given: 데이터베이스가 null인 라우터
      const nullRouter = createQualityRouter(null);
      mockRequest.query = {};

      // When: 리포트 생성 요청
      const handler = nullRouter.stack.find(layer => layer.route?.path === '/report' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 500 에러 반환
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'QualityAssuranceService not initialized'
        })
      );
    });
  });

  describe('GET /api/v1/quality/report/data', () => {
    it('should return report data as JSON', async () => {
      // Given: 리포트 데이터 요청
      mockRequest.query = {};

      // When: 리포트 데이터 조회 요청
      const handler = router.stack.find(layer => layer.route?.path === '/report/data' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: JSON 형식으로 리포트 데이터 반환
      expect(mockResponse.json).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/quality/history', () => {
    it('should return measurement history', async () => {
      // Given: 측정 이력 요청
      mockRequest.query = {};

      // When: 측정 이력 조회 요청
      const handler = router.stack.find(layer => layer.route?.path === '/history' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 측정 이력 반환
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          history: expect.any(Array),
          count: expect.any(Number),
          limit: expect.any(Number)
        })
      );
    });

    it('should filter by namespace when provided', async () => {
      // Given: 네임스페이스 필터로 측정 이력 요청
      mockRequest.query = { namespace: 'search' };

      // When: 측정 이력 조회 요청
      const handler = router.stack.find(layer => layer.route?.path === '/history' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 필터링된 측정 이력 반환
      expect(mockResponse.json).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/quality/thresholds', () => {
    it('should return all thresholds', async () => {
      // Given: 임계값 조회 요청
      mockRequest.query = {};

      // When: 임계값 조회 요청
      const handler = router.stack.find(layer => layer.route?.path === '/thresholds' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 임계값 목록 반환
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          thresholds: expect.any(Array),
          count: expect.any(Number),
          namespace: expect.any(String),
          context: expect.any(String)
        })
      );
    });
  });

  describe('GET /api/v1/quality/thresholds/:namespace/:key', () => {
    it('should return specific threshold', async () => {
      // Given: 특정 임계값 설정
      const thresholdManager = new QualityThresholdManager(db);
      thresholdManager.setThreshold('search', 'precision_at_5', { threshold_value: 0.7, threshold_type: 'min' }, 'default');

      mockRequest.params = { namespace: 'search', key: 'precision_at_5' };
      mockRequest.query = { context: 'default' };

      // When: 특정 임계값 조회 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/:namespace/:key' && layer.route?.methods.get
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 특정 임계값 반환
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metric_namespace: 'search',
          metric_key: 'precision_at_5',
          threshold_value: 0.7,
          threshold_type: 'min'
        })
      );
    });

    it('should return 404 when threshold not found', async () => {
      // Given: 존재하지 않는 임계값 조회 요청
      mockRequest.params = { namespace: 'search', key: 'nonexistent' };
      mockRequest.query = { context: 'default' };

      // When: 특정 임계값 조회 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/:namespace/:key' && layer.route?.methods.get
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 404 에러 반환
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Threshold not found'
        })
      );
    });
  });

  describe('PUT /api/v1/quality/thresholds/:namespace/:key', () => {
    it('should create or update threshold', async () => {
      // Given: 임계값 설정 요청
      mockRequest.params = { namespace: 'search', key: 'precision_at_5' };
      mockRequest.body = {
        threshold_value: 0.8,
        threshold_type: 'min',
        description: 'Test threshold',
        context: 'default'
      };

      // When: 임계값 설정 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/:namespace/:key' && layer.route?.methods.put
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 임계값 설정 성공
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '임계값이 설정되었습니다',
          threshold: expect.objectContaining({
            metric_namespace: 'search',
            metric_key: 'precision_at_5',
            threshold_value: 0.8,
            threshold_type: 'min'
          })
        })
      );
    });

    it('should return 400 when threshold_value is missing', async () => {
      // Given: threshold_value가 없는 요청
      mockRequest.params = { namespace: 'search', key: 'precision_at_5' };
      mockRequest.body = {
        threshold_type: 'min'
      };

      // When: 임계값 설정 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/:namespace/:key' && layer.route?.methods.put
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 400 에러 반환
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid request'
        })
      );
    });

    it('should return 400 when threshold_value is out of range', async () => {
      // Given: 범위를 벗어난 threshold_value 요청
      mockRequest.params = { namespace: 'search', key: 'precision_at_5' };
      mockRequest.body = {
        threshold_value: 1.5,
        threshold_type: 'min'
      };

      // When: 임계값 설정 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/:namespace/:key' && layer.route?.methods.put
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 400 에러 반환
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Invalid threshold_value'
        })
      );
    });
  });

  describe('DELETE /api/v1/quality/thresholds/:namespace/:key', () => {
    it('should delete threshold', async () => {
      // Given: 임계값 설정 후 삭제 요청
      const thresholdManager = new QualityThresholdManager(db);
      thresholdManager.setThreshold('search', 'precision_at_5', { threshold_value: 0.7, threshold_type: 'min' }, 'default');

      mockRequest.params = { namespace: 'search', key: 'precision_at_5' };
      mockRequest.query = { context: 'default' };

      // When: 임계값 삭제 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/:namespace/:key' && layer.route?.methods.delete
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 임계값 삭제 성공
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '임계값이 삭제되었습니다',
          namespace: 'search',
          key: 'precision_at_5',
          context: 'default'
        })
      );
    });

    it('should return 404 when threshold not found', async () => {
      // Given: 존재하지 않는 임계값 삭제 요청
      mockRequest.params = { namespace: 'search', key: 'nonexistent' };
      mockRequest.query = { context: 'default' };

      // When: 임계값 삭제 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/:namespace/:key' && layer.route?.methods.delete
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 404 에러 반환
      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Threshold not found'
        })
      );
    });
  });

  describe('GET /api/v1/quality/metrics', () => {
    it('should return latest metrics', async () => {
      // Given: 최신 품질 지표 요청
      mockRequest.query = {};

      // When: 최신 품질 지표 조회 요청
      const handler = router.stack.find(layer => layer.route?.path === '/metrics' && layer.route?.methods.get);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 최신 품질 지표 반환
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.any(Array),
          count: expect.any(Number),
          namespace: expect.any(String),
          context: expect.any(String)
        })
      );
    });
  });

  describe('POST /api/v1/quality/measure', () => {
    it('should execute quality measurement', async () => {
      // Given: 품질 측정 요청
      mockRequest.body = {
        measurement_type: 'batch',
        context: 'default',
        record: true
      };

      // When: 품질 측정 실행 요청
      const handler = router.stack.find(layer => layer.route?.path === '/measure' && layer.route?.methods.post);
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 품질 측정 결과 반환
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '품질 측정이 완료되었습니다',
          result: expect.objectContaining({
            measured_at: expect.any(String)
          })
        })
      );
    });
  });

  describe('POST /api/v1/quality/thresholds/init', () => {
    it('should initialize default thresholds', async () => {
      // Given: 기본 임계값 초기화 요청
      mockRequest.body = {
        context: 'default',
        overwrite: false
      };

      // When: 기본 임계값 초기화 요청
      const handler = router.stack.find(layer => 
        layer.route?.path === '/thresholds/init' && layer.route?.methods.post
      );
      if (handler && handler.route) {
        const routeHandler = handler.route.stack[0].handle;
        await routeHandler(mockRequest as Request, mockResponse as Response, mockNext);
      }

      // Then: 기본 임계값 초기화 성공
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '기본 임계값이 초기화되었습니다',
          count: expect.any(Number),
          context: 'default',
          overwrite: false
        })
      );
    });
  });
});

