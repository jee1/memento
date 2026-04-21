/**
 * Quality Assurance 라우터
 * /api/v1/quality/* 엔드포인트 처리
 * 
 * PRD FR-5.2: HTTP API 엔드포인트로 품질 리포트를 조회할 수 있어야 함
 * PRD FR-4.7: HTTP API로 임계값 조회/업데이트 기능 구현
 */

import { QualityAssuranceService,QualityThresholdManager,logger } from '@memento/core';
import type Database from 'better-sqlite3';
import { Router } from 'express';

/**
 * Quality Assurance 라우터 생성
 */
export function createQualityRouter(
  db: Database.Database | null
): Router {
  const router = Router();

  // Quality Assurance Service 초기화
  let qualityService: QualityAssuranceService | null = null;
  let thresholdManager: QualityThresholdManager | null = null;
  if (db) {
    try {
      qualityService = new QualityAssuranceService(db);
      thresholdManager = new QualityThresholdManager(db);
    } catch (error) {
      logger.error('QualityAssuranceService 초기화 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * GET /api/v1/quality/report
   * 품질 리포트 생성
   * 
   * Query Parameters:
   *   - format: 'markdown' | 'json' | 'html' (기본값: 'markdown')
   *   - namespace: 네임스페이스 필터 (선택적)
   *   - context: 컨텍스트 필터 (선택적, 기본값: 'default')
   *   - from: 시작 시간 (ISO 8601 형식, 선택적)
   *   - to: 종료 시간 (ISO 8601 형식, 선택적)
   */
  router.get('/report', async (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const format = (req.query.format as 'markdown' | 'json' | 'html') || 'markdown';
      const namespace = req.query.namespace as string | undefined;
      const context = (req.query.context as string) || 'default';
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      const report = await qualityService.generateReport({
        format,
        namespace,
        context,
        from,
        to
      });

      // Content-Type 설정
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
      } else if (format === 'html') {
        res.setHeader('Content-Type', 'text/html');
      } else {
        res.setHeader('Content-Type', 'text/markdown');
      }

      return res.send(report);
    } catch (error) {
      logger.error('품질 리포트 생성 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to generate quality report',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/v1/quality/report/data
   * 품질 리포트 데이터 조회 (JSON 형식)
   * 
   * Query Parameters:
   *   - namespace: 네임스페이스 필터 (선택적)
   *   - context: 컨텍스트 필터 (선택적, 기본값: 'default')
   *   - from: 시작 시간 (ISO 8601 형식, 선택적)
   *   - to: 종료 시간 (ISO 8601 형식, 선택적)
   */
  router.get('/report/data', async (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const namespace = req.query.namespace as string | undefined;
      const context = (req.query.context as string) || 'default';
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;

      const reportData = await qualityService.getReportData({
        namespace,
        context,
        from,
        to
      });

      return res.json(reportData);
    } catch (error) {
      logger.error('품질 리포트 데이터 조회 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to get quality report data',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/v1/quality/history
   * 측정 이력 조회
   * 
   * Query Parameters:
   *   - namespace: 네임스페이스 필터 (선택적)
   *   - context: 컨텍스트 필터 (선택적)
   *   - from: 시작 시간 (ISO 8601 형식, 선택적)
   *   - to: 종료 시간 (ISO 8601 형식, 선택적)
   *   - limit: 최대 개수 (기본값: 100)
   */
  router.get('/history', (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const namespace = req.query.namespace as string | undefined;
      const context = req.query.context as string | undefined;
      const from = req.query.from as string | undefined;
      const to = req.query.to as string | undefined;
      const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const limit = Number.isNaN(rawLimit) || rawLimit < 1 || rawLimit > 500 ? 100 : rawLimit;

      const history = qualityService.getMeasurementHistory(namespace, context, from, to, limit);

      return res.json({
        history,
        count: history.length,
        limit
      });
    } catch (error) {
      logger.error('측정 이력 조회 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to get measurement history',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/v1/quality/thresholds
   * 모든 임계값 조회
   * 
   * Query Parameters:
   *   - namespace: 네임스페이스 필터 (선택적)
   *   - context: 컨텍스트 필터 (선택적, 기본값: 'default')
   */
  router.get('/thresholds', (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const namespace = req.query.namespace as string | undefined;
      const context = (req.query.context as string) || 'default';

      const thresholds = qualityService.getThresholds(namespace, context);

      return res.json({
        thresholds,
        count: thresholds.length,
        namespace: namespace || 'all',
        context
      });
    } catch (error) {
      logger.error('임계값 조회 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to get thresholds',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/v1/quality/thresholds/:namespace/:key
   * 특정 임계값 조회
   * 
   * Query Parameters:
   *   - context: 컨텍스트 (선택적, 기본값: 'default')
   */
  router.get('/thresholds/:namespace/:key', (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      if (!thresholdManager) {
        return res.status(500).json({
          error: 'QualityThresholdManager not initialized',
          message: 'QualityThresholdManager가 초기화되지 않았습니다'
        });
      }

      const { namespace, key } = req.params;
      const context = (req.query.context as string) || 'default';

      const threshold = thresholdManager.getThreshold(namespace, key, context);

      if (!threshold) {
        return res.status(404).json({
          error: 'Threshold not found',
          message: `임계값을 찾을 수 없습니다: ${namespace}.${key} (${context})`
        });
      }

      return res.json(threshold);
    } catch (error) {
      logger.error('임계값 조회 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to get threshold',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * PUT /api/v1/quality/thresholds/:namespace/:key
   * 임계값 설정 (생성 또는 업데이트)
   * 
   * Request Body:
   *   {
   *     "threshold_value": number,
   *     "threshold_type": "min" | "max",
   *     "description"?: string,
   *     "context"?: string (기본값: "default")
   *   }
   */
  router.put('/thresholds/:namespace/:key', (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const { namespace, key } = req.params;
      const { threshold_value, threshold_type, description, context = 'default' } = req.body;

      // 유효성 검증
      if (threshold_value === undefined || threshold_type === undefined) {
        return res.status(400).json({
          error: 'Invalid request',
          message: 'threshold_value와 threshold_type은 필수입니다'
        });
      }

      if (typeof threshold_value !== 'number' || threshold_value < 0 || threshold_value > 1) {
        return res.status(400).json({
          error: 'Invalid threshold_value',
          message: 'threshold_value는 0과 1 사이의 숫자여야 합니다'
        });
      }

      if (threshold_type !== 'min' && threshold_type !== 'max') {
        return res.status(400).json({
          error: 'Invalid threshold_type',
          message: 'threshold_type은 "min" 또는 "max"여야 합니다'
        });
      }

      const threshold = qualityService.setThreshold(
        namespace,
        key,
        threshold_value,
        threshold_type,
        description,
        context
      );

      return res.json({
        message: '임계값이 설정되었습니다',
        threshold
      });
    } catch (error) {
      logger.error('임계값 설정 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to set threshold',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * DELETE /api/v1/quality/thresholds/:namespace/:key
   * 임계값 삭제
   * 
   * Query Parameters:
   *   - context: 컨텍스트 (선택적, 기본값: 'default')
   */
  router.delete('/thresholds/:namespace/:key', (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const { namespace, key } = req.params;
      const context = (req.query.context as string) || 'default';

      const deleted = qualityService.deleteThreshold(namespace, key, context);

      if (deleted) {
        return res.json({
          message: '임계값이 삭제되었습니다',
          namespace,
          key,
          context
        });
      } else {
        return res.status(404).json({
          error: 'Threshold not found',
          message: `임계값을 찾을 수 없습니다: ${namespace}.${key} (${context})`
        });
      }
    } catch (error) {
      logger.error('임계값 삭제 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to delete threshold',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * GET /api/v1/quality/metrics
   * 최신 품질 지표 조회
   * 
   * Query Parameters:
   *   - namespace: 네임스페이스 필터 (선택적)
   *   - context: 컨텍스트 필터 (선택적, 기본값: 'default')
   */
  router.get('/metrics', (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const namespace = req.query.namespace as string | undefined;
      const context = (req.query.context as string) || 'default';

      const metrics = qualityService.getLatestMetrics(namespace, context);

      return res.json({
        metrics,
        count: metrics.length,
        namespace: namespace || 'all',
        context
      });
    } catch (error) {
      logger.error('최신 품질 지표 조회 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to get latest metrics',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/v1/quality/measure
   * 품질 측정 실행
   * 
   * Request Body (선택적):
   *   {
   *     "measurement_type"?: "batch" | "test" | "manual" (기본값: "batch"),
   *     "context"?: string (기본값: "default"),
   *     "namespaces"?: string[],
   *     "record"?: boolean (기본값: true)
   *   }
   */
  router.post('/measure', async (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const {
        measurement_type = 'batch',
        context = 'default',
        namespaces,
        record = true
      } = req.body;

      const result = await qualityService.measureQuality({
        measurement_type,
        context,
        namespaces,
        record
      });

      return res.json({
        message: '품질 측정이 완료되었습니다',
        result
      });
    } catch (error) {
      logger.error('품질 측정 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to measure quality',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * POST /api/v1/quality/thresholds/init
   * 기본 임계값 초기화
   * 
   * Request Body (선택적):
   *   {
   *     "context"?: string (기본값: "default"),
   *     "overwrite"?: boolean (기본값: false)
   *   }
   */
  router.post('/thresholds/init', (req, res) => {
    try {
      if (!qualityService) {
        return res.status(500).json({
          error: 'QualityAssuranceService not initialized',
          message: 'QualityAssuranceService가 초기화되지 않았습니다'
        });
      }

      const { context = 'default', overwrite = false } = req.body;

      const count = qualityService.initializeDefaultThresholds(context, overwrite);

      return res.json({
        message: '기본 임계값이 초기화되었습니다',
        count,
        context,
        overwrite
      });
    } catch (error) {
      logger.error('기본 임계값 초기화 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({
        error: 'Failed to initialize default thresholds',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}

