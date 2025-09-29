/**
 * 간단한 성능 알림 테스트
 * console.log 차단을 우회하여 테스트
 */

import { PerformanceAlertService, AlertType, AlertLevel } from '../services/performance-alert-service.js';

// console.log 복원
const originalLog = console.log;
const originalError = console.error;

function testSimpleAlerts() {
  // console 메서드 복원
  console.log = originalLog;
  console.error = originalError;
  
  console.log('🚨 간단한 성능 알림 테스트 시작');
  
  try {
    // 성능 알림 서비스 생성
    const alertService = new PerformanceAlertService('./logs');
    
    console.log('✅ 성능 알림 서비스 생성 완료');

    // 1. 응답시간 알림 테스트
    console.log('\n📊 응답시간 알림 테스트:');
    const responseTimeAlerts = alertService.checkPerformanceMetric(
      AlertType.RESPONSE_TIME,
      150, // WARNING 임계값(100ms) 초과
      { component: 'search_engine', operation: 'search' }
    );
    console.log(`생성된 알림 수: ${responseTimeAlerts.length}`);

    // 2. 메모리 사용량 알림 테스트
    console.log('\n📊 메모리 사용량 알림 테스트:');
    const memoryAlerts = alertService.checkPerformanceMetric(
      AlertType.MEMORY_USAGE,
      150, // WARNING 임계값(100MB) 초과
      { component: 'memory_manager', heapTotal: 200 }
    );
    console.log(`생성된 알림 수: ${memoryAlerts.length}`);

    // 3. 에러율 알림 테스트
    console.log('\n📊 에러율 알림 테스트:');
    const errorRateAlerts = alertService.checkPerformanceMetric(
      AlertType.ERROR_RATE,
      7, // WARNING 임계값(5%) 초과
      { component: 'system', totalOperations: 100 }
    );
    console.log(`생성된 알림 수: ${errorRateAlerts.length}`);

    // 4. 알림 통계 조회
    console.log('\n📈 알림 통계:');
    const stats = alertService.getAlertStats(1);
    console.log(`총 알림 수: ${stats.totalAlerts}`);
    console.log(`활성 알림 수: ${stats.activeAlerts}`);
    console.log(`WARNING 알림: ${stats.alertsByLevel.warning}`);
    console.log(`CRITICAL 알림: ${stats.alertsByLevel.critical}`);

    // 5. 활성 알림 조회
    console.log('\n🔍 활성 알림:');
    const activeAlerts = alertService.getActiveAlerts();
    console.log(`활성 알림 수: ${activeAlerts.length}`);
    
    activeAlerts.forEach((alert, index) => {
      console.log(`${index + 1}. [${alert.level.toUpperCase()}] ${alert.metric}: ${alert.value} (임계값: ${alert.threshold})`);
      console.log(`   메시지: ${alert.message}`);
      console.log(`   시간: ${alert.timestamp.toISOString()}`);
    });

    // 6. 알림 해결 테스트
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

    // 7. 해결 후 통계
    console.log('\n📊 해결 후 통계:');
    const finalStats = alertService.getAlertStats(1);
    console.log(`총 알림 수: ${finalStats.totalAlerts}`);
    console.log(`활성 알림 수: ${finalStats.activeAlerts}`);
    console.log(`해결된 알림 수: ${finalStats.totalAlerts - finalStats.activeAlerts}`);

    // 8. 로그 파일 확인
    console.log('\n📁 로그 파일 확인:');
    const fs = require('fs');
    const logDir = './logs';
    if (fs.existsSync(logDir)) {
      const files = fs.readdirSync(logDir);
      console.log(`로그 파일 수: ${files.length}`);
      files.forEach((file: string) => {
        const filePath = `${logDir}/${file}`;
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.trim().split('\n');
        console.log(`- ${file}: ${lines.length}개 알림 로그`);
        
        // 첫 번째 로그 내용 출력
        if (lines.length > 0) {
          try {
            const firstLog = JSON.parse(lines[0]);
            console.log(`  첫 번째 로그: ${firstLog.level} - ${firstLog.message}`);
          } catch (e) {
            console.log(`  첫 번째 로그: ${lines[0]}`);
          }
        }
      });
    } else {
      console.log('❌ 로그 디렉토리가 존재하지 않습니다.');
    }

    // 정리
    alertService.cleanup();
    
    console.log('\n🎉 간단한 성능 알림 테스트 완료');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  }
}

// 직접 실행
testSimpleAlerts();
