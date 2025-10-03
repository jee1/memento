/**
 * 도구 등록 및 관리 시스템
 * MCP 클라이언트용 도구들의 중앙 관리
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';

export interface ToolRegistryConfig {
  enableLogging: boolean;
  enableMetrics: boolean;
  maxExecutionTime: number;
  enableCaching: boolean;
  cacheSize: number;
}

export interface ToolExecutionMetrics {
  name: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  lastExecution: Date | null;
  errorRate: number;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private config: ToolRegistryConfig;
  private metrics: Map<string, ToolExecutionMetrics> = new Map();
  private cache: Map<string, { result: any; timestamp: number; ttl: number }> = new Map();

  constructor(config?: Partial<ToolRegistryConfig>) {
    this.config = {
      enableLogging: true,
      enableMetrics: true,
      maxExecutionTime: 30000, // 30초
      enableCaching: false,
      cacheSize: 100,
      ...config
    };
  }

  /**
   * 도구 등록
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      this.log(`Tool ${tool.name} already exists, replacing`, 'warn');
    }

    this.tools.set(tool.name, tool);
    
    // 메트릭 초기화
    if (this.config.enableMetrics) {
      this.metrics.set(tool.name, {
        name: tool.name,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
        lastExecution: null,
        errorRate: 0
      });
    }

    this.log(`Tool registered: ${tool.name}`);
  }

  /**
   * 도구 등록 (배치)
   */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
    this.log(`Registered ${tools.length} tools`);
  }

  /**
   * 도구 조회
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * 모든 도구 목록 반환
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * 도구 실행
   */
  async execute(name: string, params: any, context: ToolContext): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // 캐시 확인
    if (this.config.enableCaching) {
      const cacheKey = this.generateCacheKey(name, params);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < cached.ttl) {
        this.log(`Cache hit for tool: ${name}`);
        return cached.result;
      }
    }

    const startTime = Date.now();
    let result: ToolResult;

    try {
      // 타임아웃 설정
      result = await Promise.race([
        tool.handler(params, context),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Tool execution timeout: ${name}`));
          }, this.config.maxExecutionTime);
        })
      ]);

      // 성공 메트릭 업데이트
      if (this.config.enableMetrics) {
        this.updateMetrics(name, true, Date.now() - startTime);
      }

      // 캐시 저장
      if (this.config.enableCaching && result.success) {
        this.cacheResult(name, params, result);
      }

      this.log(`Tool executed successfully: ${name}`, { duration: Date.now() - startTime });
      return result;

    } catch (error) {
      // 실패 메트릭 업데이트
      if (this.config.enableMetrics) {
        this.updateMetrics(name, false, Date.now() - startTime);
      }

      this.log(`Tool execution failed: ${name}`, { error: error instanceof Error ? error.message : String(error) }, 'error');
      throw error;
    }
  }

  /**
   * 도구 존재 여부 확인
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 도구 제거
   */
  remove(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      this.metrics.delete(name);
      this.log(`Tool removed: ${name}`);
    }
    return removed;
  }

  /**
   * 모든 도구 제거
   */
  clear(): void {
    this.tools.clear();
    this.metrics.clear();
    this.cache.clear();
    this.log('All tools cleared');
  }

  /**
   * 도구 개수 반환
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * 도구 이름 목록 반환
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 도구 검색 (이름 또는 설명 기반)
   */
  search(query: string): ToolDefinition[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.tools.values()).filter(tool => 
      tool.name.toLowerCase().includes(lowerQuery) ||
      tool.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 도구 카테고리별 그룹화
   */
  getByCategory(): Map<string, ToolDefinition[]> {
    const categories = new Map<string, ToolDefinition[]>();
    
    for (const tool of this.tools.values()) {
      const category = this.extractCategory(tool.name);
      if (!categories.has(category)) {
        categories.set(category, []);
      }
      categories.get(category)!.push(tool);
    }
    
    return categories;
  }

  /**
   * 도구 메트릭 조회
   */
  getMetrics(name?: string): ToolExecutionMetrics[] {
    if (name) {
      const metric = this.metrics.get(name);
      return metric ? [metric] : [];
    }
    return Array.from(this.metrics.values());
  }

  /**
   * 도구 상태 확인
   */
  getToolStatus(name: string): {
    exists: boolean;
    lastExecution: Date | null;
    errorRate: number;
    averageExecutionTime: number;
  } {
    const tool = this.tools.get(name);
    const metric = this.metrics.get(name);
    
    return {
      exists: !!tool,
      lastExecution: metric?.lastExecution || null,
      errorRate: metric?.errorRate || 0,
      averageExecutionTime: metric?.averageExecutionTime || 0
    };
  }

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig: Partial<ToolRegistryConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.log('Configuration updated', { config: this.config });
  }

  /**
   * 캐시 정리
   */
  clearCache(): void {
    this.cache.clear();
    this.log('Cache cleared');
  }

  /**
   * 캐시 통계
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    maxSize: number;
  } {
    const totalRequests = Array.from(this.metrics.values())
      .reduce((sum, metric) => sum + metric.totalExecutions, 0);
    const cacheHits = Array.from(this.metrics.values())
      .reduce((sum, metric) => sum + metric.successfulExecutions, 0);
    
    return {
      size: this.cache.size,
      hitRate: totalRequests > 0 ? cacheHits / totalRequests : 0,
      maxSize: this.config.cacheSize
    };
  }

  /**
   * 도구 검증
   */
  validateTool(tool: ToolDefinition): string[] {
    const errors: string[] = [];
    
    if (!tool.name || tool.name.trim().length === 0) {
      errors.push('Tool name is required');
    }
    
    if (!tool.description || tool.description.trim().length === 0) {
      errors.push('Tool description is required');
    }
    
    if (!tool.handler || typeof tool.handler !== 'function') {
      errors.push('Tool handler must be a function');
    }
    
    if (tool.inputSchema && typeof tool.inputSchema !== 'object') {
      errors.push('Tool inputSchema must be an object');
    }
    
    return errors;
  }

  /**
   * 모든 도구 검증
   */
  validateAllTools(): Map<string, string[]> {
    const results = new Map<string, string[]>();
    
    for (const [name, tool] of this.tools) {
      const errors = this.validateTool(tool);
      if (errors.length > 0) {
        results.set(name, errors);
      }
    }
    
    return results;
  }

  /**
   * 메트릭 업데이트
   */
  private updateMetrics(name: string, success: boolean, executionTime: number): void {
    const metric = this.metrics.get(name);
    if (!metric) return;

    metric.totalExecutions++;
    if (success) {
      metric.successfulExecutions++;
    } else {
      metric.failedExecutions++;
    }
    
    // 평균 실행 시간 업데이트
    metric.averageExecutionTime = 
      (metric.averageExecutionTime * (metric.totalExecutions - 1) + executionTime) / metric.totalExecutions;
    
    metric.lastExecution = new Date();
    metric.errorRate = metric.failedExecutions / metric.totalExecutions;
  }

  /**
   * 캐시 키 생성
   */
  private generateCacheKey(name: string, params: any): string {
    return `${name}:${JSON.stringify(params)}`;
  }

  /**
   * 결과 캐시 저장
   */
  private cacheResult(name: string, params: any, result: ToolResult): void {
    if (this.cache.size >= this.config.cacheSize) {
      // 가장 오래된 항목 제거
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    const cacheKey = this.generateCacheKey(name, params);
    this.cache.set(cacheKey, {
      result,
      timestamp: Date.now(),
      ttl: 5 * 60 * 1000 // 5분
    });
  }

  /**
   * 카테고리 추출
   */
  private extractCategory(name: string): string {
    if (name.includes('memory') || name.includes('remember') || name.includes('recall')) {
      return 'memory';
    }
    if (name.includes('search') || name.includes('find')) {
      return 'search';
    }
    if (name.includes('cleanup') || name.includes('forget')) {
      return 'maintenance';
    }
    if (name.includes('performance') || name.includes('monitor')) {
      return 'monitoring';
    }
    return 'other';
  }

  /**
   * 로깅
   */
  private log(message: string, data?: any, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.enableLogging) return;

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ToolRegistry] [${level.toUpperCase()}] ${message}`;
    
    switch (level) {
      case 'error':
        console.error(logMessage, data ? JSON.stringify(data, null, 2) : '');
        break;
      case 'warn':
        console.warn(logMessage, data ? JSON.stringify(data, null, 2) : '');
        break;
      default:
        console.log(logMessage, data ? JSON.stringify(data, null, 2) : '');
    }
  }
}