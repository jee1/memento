/* eslint-disable no-console */
/**
 * 최근성(Recency) 계산 결과 시각화
 * forgetting-algorithm.ts의 calculateRecency 메서드 결과를 그래프로 표시
 */

// ForgettingAlgorithm은 사용되지 않지만 타입 참조를 위해 주석 처리
// import { ForgettingAlgorithm } from '../algorithms/forgetting-algorithm';

interface RecencyData {
  ageDays: number;
  working: number;
  episodic: number;
  semantic: number;
  procedural: number;
}

/**
 * 최근성 계산 (반감기 기반 지수 감쇠)
 */
function calculateRecency(ageDays: number, halfLife: number): number {
  return Math.exp(-Math.log(2) * ageDays / halfLife);
}

/**
 * 데이터 생성
 */
function generateRecencyData(maxDays: number = 365): RecencyData[] {
  const data: RecencyData[] = [];
  
  // 반감기 설정
  const halfLives = {
    working: 2,
    episodic: 30,
    semantic: 180,
    procedural: 90
  };
  
  for (let day = 0; day <= maxDays; day += 1) {
    data.push({
      ageDays: day,
      working: calculateRecency(day, halfLives.working),
      episodic: calculateRecency(day, halfLives.episodic),
      semantic: calculateRecency(day, halfLives.semantic),
      procedural: calculateRecency(day, halfLives.procedural)
    });
  }
  
  return data;
}

/**
 * 콘솔 그래프 출력 (ASCII Art)
 */
function printConsoleGraph(data: RecencyData[], width: number = 60, height: number = 20): void {
  console.log('\n=== 최근성(Recency) 계산 결과 그래프 ===\n');
  console.log('공식: recency = exp(-ln(2) * ageDays / halfLife)');
  console.log('반감기: working(2일), episodic(30일), semantic(180일), procedural(90일)\n');
  
  // Y축 범위: 0 ~ 1
  const maxValue = 1.0;
  const minValue = 0.0;
  
  // 샘플링 (너무 많은 데이터는 표시하지 않음)
  const step = Math.ceil(data.length / width);
  const sampledData = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  
  // 그래프 그리기
  const graph: string[][] = Array(height + 1).fill(null).map(() => Array(width).fill(' '));
  
  // Y축 레이블 및 그리드
  for (let y = 0; y <= height; y++) {
    const value = maxValue - (y / height) * (maxValue - minValue);
    const label = value.toFixed(1).padStart(4);
    graph[y][0] = label;
    graph[y][1] = '│';
    
    // 그리드 라인
    for (let x = 2; x < width; x++) {
      if (y === height) {
        graph[y][x] = '─';
      } else if (y % (height / 4) === 0) {
        graph[y][x] = '·';
      }
    }
  }
  
  // 데이터 포인트 그리기
  const colors = {
    working: 'W',
    episodic: 'E',
    semantic: 'S',
    procedural: 'P'
  };
  
  for (const type of ['working', 'episodic', 'semantic', 'procedural'] as const) {
    sampledData.forEach((point, idx) => {
      const x = Math.floor((idx / sampledData.length) * (width - 2)) + 2;
      const y = Math.floor((1 - point[type]) * height);
      
      if (x < width && y >= 0 && y <= height) {
        if (graph[y][x] === ' ' || graph[y][x] === '·') {
          graph[y][x] = colors[type];
        } else {
          graph[y][x] = '*'; // 겹치는 지점
        }
      }
    });
  }
  
  // 그래프 출력
  for (let y = 0; y <= height; y++) {
    console.log(graph[y].join(''));
  }
  
  // X축 레이블
  console.log('     ' + '0'.padStart(width - 10) + '일'.padEnd(10));
  const maxDays = data[data.length - 1].ageDays;
  console.log('     ' + maxDays.toString().padStart(width - 10) + '일'.padEnd(10));
  
  // 범례
  console.log('\n범례:');
  console.log('  W = working (반감기: 2일)');
  console.log('  E = episodic (반감기: 30일)');
  console.log('  S = semantic (반감기: 180일)');
  console.log('  P = procedural (반감기: 90일)');
  console.log('  * = 겹치는 지점\n');
}

/**
 * 주요 지점 표시
 */
function printKeyPoints(data: RecencyData[]): void {
  console.log('=== 주요 지점 분석 ===\n');
  
  const halfLives = {
    working: 2,
    episodic: 30,
    semantic: 180,
    procedural: 90
  };
  
  for (const [type, halfLife] of Object.entries(halfLives)) {
    const point = data.find(d => Math.abs(d.ageDays - halfLife) < 0.5);
    if (point) {
      console.log(`${type.padEnd(12)}: ${halfLife}일 경과 시 recency = ${point[type as keyof RecencyData].toFixed(4)} (이론값: 0.5000)`);
    }
    
    // 0.1, 0.2, 0.5, 0.8 지점 찾기
    const targets = [0.8, 0.5, 0.2, 0.1];
    for (const target of targets) {
      const point = data.find(d => Math.abs((d[type as keyof RecencyData] as number) - target) < 0.01);
      if (point) {
        console.log(`  → recency ${target} 달성: ${point.ageDays.toFixed(1)}일 경과`);
      }
    }
    console.log('');
  }
}

/**
 * CSV 형식으로 출력 (다른 도구에서 사용 가능)
 */
function printCSV(data: RecencyData[]): void {
  console.log('\n=== CSV 형식 데이터 ===\n');
  console.log('ageDays,working,episodic,semantic,procedural');
  
  // 샘플링 (너무 많은 데이터는 출력하지 않음)
  const step = Math.ceil(data.length / 100);
  data.filter((_, i) => i % step === 0 || i === data.length - 1).forEach(point => {
    console.log(
      `${point.ageDays},${point.working.toFixed(6)},${point.episodic.toFixed(6)},${point.semantic.toFixed(6)},${point.procedural.toFixed(6)}`
    );
  });
}

/**
 * 메인 실행
 */
function main() {
  // 1년치 데이터 생성
  const data = generateRecencyData(365);
  
  // 콘솔 그래프 출력
  printConsoleGraph(data);
  
  // 주요 지점 분석
  printKeyPoints(data);
  
  // CSV 출력 (선택적)
  if (process.argv.includes('--csv')) {
    printCSV(data);
  }
  
  console.log('\n=== 그래프 해석 ===');
  console.log('1. 모든 곡선은 지수 감쇠 형태를 보입니다.');
  console.log('2. 반감기 시간이 지나면 recency 값이 정확히 0.5가 됩니다.');
  console.log('3. working 타입이 가장 빠르게 감쇠하고, semantic이 가장 느리게 감쇠합니다.');
  console.log('4. 시간이 지날수록 모든 타입의 recency 값이 0에 가까워집니다.\n');
}

// 실행
main();

export { generateRecencyData, calculateRecency };

