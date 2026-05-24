/**
 * 환경 변수 기본값 및 해석 도우미
 * - 우선순위: 프로세스 환경 변수 > 추가 지정 fallback 키 > 기본값
 * - 빈 문자열은 기본적으로 무시하며 allowEmpty 옵션으로 허용 가능
 */

import os from 'os';
import path from 'path';

const ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'development',
  MCP_SERVER_NAME: 'memento-memory',
  MCP_SERVER_VERSION: '0.1.0',
  MCP_SERVER_PORT: '3000',
  DB_PATH: `${os.homedir()}/.memento/memory.db`,
  LOG_LEVEL: 'info',
  EMBEDDING_PROVIDER: 'minilm',
  OPENAI_MODEL: 'text-embedding-3-small',
  OPENAI_LLM_MODEL: 'gpt-4o-mini',
  GEMINI_MODEL: 'text-embedding-004',
  GEMINI_LLM_MODEL: 'gemini-2.0-flash',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_MODEL: 'llama3',
  LLM_PROVIDER: 'auto',
  SEARCH_DEFAULT_LIMIT: '10',
  SEARCH_MAX_LIMIT: '50',
  FORGET_WORKING_TTL: '48',
  FORGET_EPISODIC_TTL: '2160',
  FORGET_SEMANTIC_TTL: '-1',
  FORGET_PROCEDURAL_TTL: '-1',
  MEMENTO_TYPE_PARAM_MODE: 'warn',
  // WAL 체크포인트 스케줄러 설정
  WAL_CHECKPOINT_INTERVAL_MS: '300000', // 5분 (300000ms)
  WAL_SIZE_WARNING_THRESHOLD: '16777216', // 16MB
  WAL_SIZE_DANGER_THRESHOLD: '25165824', // 24MB
  WAL_CHECKPOINT_USE_DEDICATED_CONNECTION: 'true',
  WAL_CHECKPOINT_MAX_RETRIES: '3',
  WAL_CHECKPOINT_RETRY_BACKOFF_MS: '1000',
  DIAGNOSTICS_ENABLED: 'false',
  DIAGNOSTICS_INTERVAL_MS: '15000',
  DIAGNOSTICS_LOG_DIR: '/app/logs/diagnostics',
  // 데이터베이스 락 모니터 설정
  LOCK_MONITOR_INTERVAL_MS: '60000', // 1분 (60000ms)
  LOCK_MONITOR_WARNING_THRESHOLD_MS: '5000', // 5초
  LOCK_MONITOR_DANGER_THRESHOLD_MS: '30000', // 30초
  LOCK_MONITOR_CRITICAL_THRESHOLD_MS: '60000', // 60초
  BATCH_SCHEDULER_ENABLED: 'true',
  WAL_CHECKPOINT_ENABLED: 'true',
  DB_LOCK_MONITOR_ENABLED: 'true',
  // PII 마스킹 설정 (PRD 0019: 보안 강화)
  ENABLE_PII_MASKING: 'true', // 기본값: true (보안 우선)
  // 성능 경고 임계값
  PERF_MEMORY_WARN_PERCENT: '85',   // 메모리 경고 임계값 (기본: 85%)
  PERF_CPU_WARN_PERCENT: '75',      // CPU 경고 임계값 (기본: 75%)
  // 배치 스케줄러 간격
  BATCH_HEALTH_CHECK_INTERVAL_MS: '300000',    // 헬스체크 주기 (기본: 5분)
  BATCH_MONITORING_INTERVAL_MS: '300000',      // 모니터링 수집 주기 (기본: 5분)
  BATCH_JOB_PROCESSOR_INTERVAL_MS: '1000',     // 큐 폴링 주기 (기본: 1000ms)
  TELEMETRY_RETENTION_DAYS: '90'
};

interface ResolveEnvOptions {
  fallbackKeys?: string[];
  defaultValue?: string;
  allowEmpty?: boolean;
  useDefault?: boolean;
}

const toArray = (value: string | undefined | string[]): string[] =>
  Array.isArray(value) ? value : value ? [value] : [];

export function resolveEnv(
  key: string,
  options: ResolveEnvOptions = {}
): string | undefined {
  const searchKeys = [key, ...toArray(options.fallbackKeys)];

  for (const currentKey of searchKeys) {
    const raw = process.env[currentKey];
    if (raw === undefined) {
      continue;
    }
    if (!options.allowEmpty && raw.trim() === '') {
      continue;
    }
    return raw;
  }

  if (options.defaultValue !== undefined) {
    return options.defaultValue;
  }

  if (options.useDefault === false) {
    return undefined;
  }

  return ENV_DEFAULTS[key];
}

export function resolveString(
  key: string,
  options: ResolveEnvOptions = {}
): string {
  return resolveEnv(key, { ...options, useDefault: options.useDefault ?? true }) ?? '';
}

export function expandHomeDirPath(value: string): string {
  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

export function resolveOptionalString(
  key: string,
  options: ResolveEnvOptions = {}
): string | undefined {
  const value = resolveEnv(key, { ...options, useDefault: options.useDefault ?? false });
  if (value === undefined) {
    return undefined;
  }
  if (!options.allowEmpty && value.trim() === '') {
    return undefined;
  }
  return value;
}

interface ResolveNumberOptions {
  fallbackKeys?: string[];
  allowEmpty?: boolean;
  useDefault?: boolean;
  defaultValue?: number;
}

export function resolveNumber(
  key: string,
  options: ResolveNumberOptions = {}
): number {
  const { defaultValue, fallbackKeys, allowEmpty, useDefault } = options;
  const raw = resolveEnv(key, {
    fallbackKeys,
    allowEmpty,
    useDefault: useDefault ?? true,
    defaultValue: defaultValue !== undefined ? String(defaultValue) : undefined
  });
  const fallback =
    defaultValue ??
    (ENV_DEFAULTS[key] !== undefined ? Number.parseInt(ENV_DEFAULTS[key], 10) : undefined);

  if (raw === undefined) {
    return fallback ?? NaN;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return fallback ?? NaN;
  }
  return parsed;
}

export function resolveOptionalNumber(
  key: string,
  options: ResolveNumberOptions = {}
): number | undefined {
  const { defaultValue, fallbackKeys, allowEmpty, useDefault } = options;
  const raw = resolveEnv(key, {
    fallbackKeys,
    allowEmpty,
    useDefault: useDefault ?? false,
    defaultValue: undefined
  });
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

interface ResolveBooleanOptions {
  fallbackKeys?: string[];
  allowEmpty?: boolean;
  useDefault?: boolean;
  defaultValue?: boolean;
}

export function resolveBoolean(
  key: string,
  options: ResolveBooleanOptions = {}
): boolean {
  const { defaultValue, fallbackKeys, allowEmpty, useDefault } = options;
  const raw = resolveEnv(key, {
    fallbackKeys,
    allowEmpty,
    useDefault: useDefault ?? true,
    defaultValue: defaultValue !== undefined ? String(defaultValue) : undefined
  });
  const fallback =
    defaultValue ??
    (ENV_DEFAULTS[key] !== undefined ? ENV_DEFAULTS[key] === 'true' : undefined);

  if (raw === undefined) {
    return fallback ?? false;
  }

  const normalized = raw.toLowerCase().trim();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * 환경 변수를 숫자로 읽어 validate 함수로 검증합니다.
 * 유효하지 않은 값(NaN, 검증 실패)은 경고 로그를 출력하고 defaultValue를 반환합니다.
 */
export function resolveValidatedNumber(
  key: string,
  defaultValue: number,
  validate: (n: number) => boolean,
  hint: string
): number {
  const raw = process.env[key] ?? ENV_DEFAULTS[key];
  if (raw === undefined) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || !validate(parsed)) {
    console.warn(
      `[memento] 환경 변수 ${key}="${raw}" 유효하지 않음 (${hint}). 기본값 ${defaultValue} 사용.`
    );
    return defaultValue;
  }
  return parsed;
}

export const providerDimensionDefaults: Record<string, number> = {
  tfidf: 512,
  lightweight: 384,
  minilm: 384,
  openai: 1536,
  gemini: 768
};

export function getRawEnvValue(key: string): string | undefined {
  return process.env[key];
}
