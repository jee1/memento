/**
 * Semantic Memory 생성 통계 수집 서비스
 * 
 * PRD 8.2: Semantic Memory 생성 통계
 * - 생성된 Semantic Memory 수
 * - 업데이트된 Semantic Memory 수
 * - 중복 제거된 항목 수
 */

/**
 * Semantic Memory 생성 통계
 */
export interface SemanticMemoryStatistics {
  // 전체 통계
  totalProcessed: number;             // 처리된 Triple 수
  totalCreated: number;               // 생성된 Semantic Memory 수
  totalUpdated: number;               // 업데이트된 Semantic Memory 수
  totalSkipped: number;               // 건너뛴 Semantic Memory 수 (confidence 임계값 미만)
  totalDuplicates: number;            // 중복 제거된 항목 수
  
  // Confidence 통계
  totalConfidence: number;            // 총 Confidence 합
  averageConfidence: number;          // 평균 Confidence
  minConfidence: number;              // 최소 Confidence
  maxConfidence: number;              // 최대 Confidence
  
  // 처리 시간 통계
  totalProcessingTime: number;        // 전체 처리 시간 (밀리초)
  averageProcessingTime: number;     // 평균 처리 시간 (밀리초)
  
  // 에러 통계
  totalErrors: number;                 // 에러 발생 횟수
  errorRate: number;                  // 에러율 (0.0 ~ 1.0)
  
  // 타임스탬프
  firstRecorded: number;              // 첫 기록 시간
  lastRecorded: number;              // 마지막 기록 시간
}

/**
 * Semantic Memory 생성 통계 수집 서비스
 */
export class SemanticMemoryStatisticsService {
  private statistics: SemanticMemoryStatistics;
  private confidenceValues: number[] = []; // Confidence 히스토리 (최근 1000개)
  private processingTimes: number[] = []; // 처리 시간 히스토리 (최근 1000개)

  constructor() {
    this.statistics = this.initializeStatistics();
  }

  /**
   * 통계 초기화
   */
  private initializeStatistics(): SemanticMemoryStatistics {
    return {
      totalProcessed: 0,
      totalCreated: 0,
      totalUpdated: 0,
      totalSkipped: 0,
      totalDuplicates: 0,
      totalConfidence: 0,
      averageConfidence: 0,
      minConfidence: Infinity,
      maxConfidence: 0,
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      totalErrors: 0,
      errorRate: 0.0,
      firstRecorded: Date.now(),
      lastRecorded: Date.now()
    };
  }

  /**
   * Semantic Memory 생성/업데이트 결과 기록
   * 
   * @param created 생성된 Semantic Memory 수
   * @param updated 업데이트된 Semantic Memory 수
   * @param skipped 건너뛴 Semantic Memory 수
   * @param duplicates 중복 제거된 항목 수
   * @param confidences Confidence 값 배열
   * @param processingTime 처리 시간 (밀리초)
   * @param error 에러 발생 여부
   */
  recordUpdate(
    created: number,
    updated: number,
    skipped: number,
    duplicates: number,
    confidences: number[],
    processingTime: number,
    error: boolean = false
  ): void {
    this.statistics.totalProcessed += (created + updated + skipped);
    this.statistics.totalCreated += created;
    this.statistics.totalUpdated += updated;
    this.statistics.totalSkipped += skipped;
    this.statistics.totalDuplicates += duplicates;
    this.statistics.lastRecorded = Date.now();

    // Confidence 통계
    for (const confidence of confidences) {
      this.confidenceValues.push(confidence);
      
      // 최근 1000개만 유지 (메모리 효율성)
      if (this.confidenceValues.length > 1000) {
        this.confidenceValues.shift();
      }
      
      this.statistics.totalConfidence += confidence;
      this.statistics.minConfidence = Math.min(this.statistics.minConfidence, confidence);
      this.statistics.maxConfidence = Math.max(this.statistics.maxConfidence, confidence);
    }
    
    // 평균 Confidence 계산 (최근 1000개 기준)
    if (this.confidenceValues.length > 0) {
      const sum = this.confidenceValues.reduce((acc, conf) => acc + conf, 0);
      this.statistics.averageConfidence = sum / this.confidenceValues.length;
    }

    // 처리 시간 통계
    this.processingTimes.push(processingTime);
    
    // 최근 1000개만 유지 (메모리 효율성)
    if (this.processingTimes.length > 1000) {
      this.processingTimes.shift();
    }
    
    this.statistics.totalProcessingTime += processingTime;
    
    // 평균 처리 시간 계산 (최근 1000개 기준)
    if (this.processingTimes.length > 0) {
      const sum = this.processingTimes.reduce((acc, time) => acc + time, 0);
      this.statistics.averageProcessingTime = sum / this.processingTimes.length;
    }

    // 에러 통계
    if (error) {
      this.statistics.totalErrors++;
    }
    
    // 에러율 계산
    this.statistics.errorRate = this.statistics.totalProcessed > 0
      ? this.statistics.totalErrors / this.statistics.totalProcessed
      : 0.0;
  }

  /**
   * 통계 조회
   * 
   * @returns Semantic Memory 생성 통계
   */
  getStatistics(): SemanticMemoryStatistics {
    return { ...this.statistics };
  }

  /**
   * 통계 리셋
   */
  reset(): void {
    this.statistics = this.initializeStatistics();
    this.confidenceValues = [];
    this.processingTimes = [];
  }
}

