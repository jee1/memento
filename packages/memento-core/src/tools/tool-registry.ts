/**
 * 도구 등록 및 관리 시스템
 * @memento/core: MCP/서버에서 공유하는 도구 레지스트리
 */

import type { ToolDefinition, ToolContext, ToolResult } from './types.js';
import { logger } from '../shared/utils/logger.js';

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
  private cache: Map<string, { result: ToolResult; timestamp: number; ttl: number }> = new Map();

  constructor(config?: Partial<ToolRegistryConfig>) {
    this.config = {
      enableLogging: true,
      enableMetrics: true,
      maxExecutionTime: 30000,
      enableCaching: false,
      cacheSize: 100,
      ...config
    };
  }

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      this.log(`Tool ${tool.name} already exists, replacing`, 'warn');
    }
    this.tools.set(tool.name, tool);
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

  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
    this.log(`Registered ${tools.length} tools`);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async execute(name: string, params: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
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
      result = await Promise.race([
        tool.handler(params, context),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Tool execution timeout: ${name}`)), this.config.maxExecutionTime);
        })
      ]);
      if (this.config.enableMetrics) {
        this.updateMetrics(name, true, Date.now() - startTime);
      }
      if (this.config.enableCaching && result.success) {
        this.cacheResult(name, params, result);
      }
      this.log(`Tool executed successfully: ${name}`, { duration: Date.now() - startTime });
      return result;
    } catch (error) {
      if (this.config.enableMetrics) {
        this.updateMetrics(name, false, Date.now() - startTime);
      }
      this.log(`Tool execution failed: ${name}`, { error: error instanceof Error ? error.message : String(error) }, 'error');
      throw error;
    }
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  remove(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) this.metrics.delete(name);
    return removed;
  }

  clear(): void {
    this.tools.clear();
    this.metrics.clear();
    this.cache.clear();
  }

  size(): number {
    return this.tools.size;
  }

  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  private updateMetrics(name: string, success: boolean, executionTime: number): void {
    const metric = this.metrics.get(name);
    if (!metric) return;
    metric.totalExecutions++;
    if (success) metric.successfulExecutions++;
    else metric.failedExecutions++;
    metric.averageExecutionTime =
      (metric.averageExecutionTime * (metric.totalExecutions - 1) + executionTime) / metric.totalExecutions;
    metric.lastExecution = new Date();
    metric.errorRate = metric.failedExecutions / metric.totalExecutions;
  }

  private generateCacheKey(name: string, params: unknown): string {
    return `${name}:${JSON.stringify(params)}`;
  }

  private cacheResult(name: string, params: unknown, result: ToolResult): void {
    if (this.cache.size >= this.config.cacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(this.generateCacheKey(name, params), {
      result,
      timestamp: Date.now(),
      ttl: 5 * 60 * 1000
    });
  }

  private log(message: string, data?: unknown, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (!this.config.enableLogging) return;
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ToolRegistry] [${level.toUpperCase()}] ${message}`;
    switch (level) {
      case 'error':
        logger.error(logMessage, data ? { data } : {});
        break;
      case 'warn':
        logger.warn(logMessage, data ? { data } : {});
        break;
      default:
        logger.info(logMessage, data ? { data } : {});
    }
  }
}
