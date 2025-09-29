/**
 * 성능 알림 시스템 직접 테스트
 * MCP 서버 없이 직접 성능 알림 서비스를 테스트
 */

import { PerformanceAlertService, AlertType, AlertLevel } from '../services/performance-alert-service.js';
import { PerformanceMonitoringIntegration } from '../services/performance-monitoring-integration.js';
import Database from 'better-sqlite3';

async function testAlertsDirect() {
  console.log('🚨 성능 알림 시스템 직접 테스트 시작');
  
  try {
    // 데이터베이스 초기화
    const db = new Database('./data/memory.db');
    
    // 성능 알림 서비스 생성
    const alertService = new PerformanceAlertService('./logs');
    
    // 통합 모니터링 서비스 생성
    const monitoringIntegration = new PerformanceMonitoringIntegration(
      db,
      alertService,
      {
        enableRealTimeMonitoring: false, // 수동 테스트를 위해 비활성화
        monitoringInterval: 30000,
        alertThresholds: {
          responseTime: { warning: 50, critical: 100 }, // 낮은 임계값으로 설정
          memoryUsage: { warning: 10, critical: 20 },   // 낮은 임계값으로 설정
          errorRate: { warning: 1, critical: 5 },
          throughput: { warning: 50, critical: 10 }
        }
      }
    );

    console.log('✅ 서비스 초기화 완료');

    // 1. 수동으로 성능 메트릭 체크
    console.log('\n🔍 수동 성능 메트릭 체크:');
    
    // 응답시간 알림 테스트
    console.log('📊 응답시간 알림 테스트 (60ms - WARNING 임계값 초과):');
    const responseTimeAlerts = alertService.checkPerformanceMetric(
      AlertType.RESPONSE_TIME,
      60, // WARNING 임계값(50ms) 초과
      { component: 'search_engine', operation: 'search' }
    );
    console.log(`생성된 알림 수: ${responseTimeAlerts.length}`);

    // 메모리 사용량 알림 테스트
    console.log('📊 메모리 사용량 알림 테스트 (15MB - WARNING 임계값 초과):');
    const memoryAlerts = alertService.checkPerformanceMetric(
      AlertType.MEMORY_USAGE,
      15, // WARNING 임계값(10MB) 초과
      { component: 'memory_manager', heapTotal: 100 }
    );
    console.log(`생성된 알림 수: ${memoryAlerts.length}`);

    // 에러율 알림 테스트
    console.log('📊 에러율 알림 테스트 (3% - WARNING 임계값 초과):');
    const errorRateAlerts = alertService.checkPerformanceMetric(
      AlertType.ERROR_RATE,
      3, // WARNING 임계값(1%) 초과
      { component: 'system', totalOperations: 100 }
    );
    console.log(`생성된 알림 수: ${errorRateAlerts.length}`);

    // 2. 알림 통계 조회
    console.log('\n📈 알림 통계:');
    const stats = alertService.getAlertStats(1);
    console.log(JSON.stringify(stats, null, 2));

    // 3. 활성 알림 조회
    console.log('\n🔍 활성 알림:');
    const activeAlerts = alertService.getActiveAlerts();
    console.log(`활성 알림 수: ${activeAlerts.length}`);
    activeAlerts.forEach((alert, index) => {
      console.log(`${index + 1}. ${alert.level.toUpperCase()}: ${alert.message}`);
    });

    // 4. 알림 해결 테스트
    if (activeAlerts.length > 0) {
      const firstAlert = activeAlerts[0];
      if (firstAlert) {
        console.log(`\n🔧 알림 해결 테스트: ${firstAlert.id}`);
        
        const resolved = alertService.resolveAlert(
          firstAlert.id,
          'test_user',
          '테스트용 해결'
        );
        
        if (resolved) {
          console.log('✅ 알림 해결 성공');
        } else {
          console.log('❌ 알림 해결 실패');
        }
      }
    }

    // 5. 해결 후 통계
    console.log('\n📊 해결 후 통계:');
    const finalStats = alertService.getAlertStats(1);
    console.log(JSON.stringify(finalStats, null, 2));

    // 6. 로그 파일 확인
    console.log('\n📁 로그 파일 확인:');
    const fs = require('fs');
    const logDir = './logs';
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir);
      console.log(`로그 파일 수: ${files.length}`);
      files.forEach((file: string) => {
        console.log(`- ${file}`);
      });
    } else {
      console.log('로그 디렉토리가 존재하지 않습니다.');
    }

    // 정리
    alertService.cleanup();
    db.close();
    
    console.log('\n🎉 성능 알림 시스템 직접 테스트 완료');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  }
}

// 직접 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testAlertsDirect().catch(console.error);
}

export { testAlertsDirect };
