/**
 * 환경 변수 기본값 및 해석 도우미
 * - 우선순위: 프로세스 환경 변수 > 추가 지정 fallback 키 > 기본값
 * - 빈 문자열은 기본적으로 무시하며 allowEmpty 옵션으로 허용 가능
 */

const ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: 'development',
  MCP_SERVER_NAME: 'memento-memory',
  MCP_SERVER_VERSION: '0.1.0',
  MCP_SERVER_PORT: '3000',
  DB_PATH: './data/memory.db',
  LOG_LEVEL: 'info',
  EMBEDDING_PROVIDER: 'minilm',
  OPENAI_MODEL: 'text-embedding-3-small',
  OPENAI_LLM_MODEL: 'gpt-4o-mini',
  GEMINI_MODEL: 'text-embedding-004',
  OLLAMA_BASE_URL: 'http://localhost:11434',
  OLLAMA_MODEL: 'llama3',
  LLM_PROVIDER: 'auto',
  SEARCH_DEFAULT_LIMIT: '10',
  SEARCH_MAX_LIMIT: '50',
  FORGET_WORKING_TTL: '48',
  FORGET_EPISODIC_TTL: '2160',
  FORGET_SEMANTIC_TTL: '-1',
  FORGET_PROCEDURAL_TTL: '-1',
  MEMENTO_TYPE_PARAM_MODE: 'warn'
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
