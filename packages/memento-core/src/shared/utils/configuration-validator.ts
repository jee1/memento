import type { EmbeddingProvider } from '../types/embedding.types.js';
import type { MementoConfig } from '../types/index.js';
import { getRawEnvValue, providerDimensionDefaults } from '../config/environment.js';

export type ValidationLevel = 'error' | 'warning';

export interface ConfigValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  suggestion?: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationIssue[];
  warnings: ConfigValidationIssue[];
}

interface ValidateOptions {
  throwOnError?: boolean;
  logger?: {
    warn?: (message?: unknown, ...optionalParams: unknown[]) => void;
    error?: (message?: unknown, ...optionalParams: unknown[]) => void;
  };
}

type ProviderRequirement = {
  requiresKey?: boolean;
  keyField?: keyof Pick<MementoConfig, 'openaiApiKey' | 'geminiApiKey'>;
};

const providerRequirements: Record<EmbeddingProvider, ProviderRequirement> = {
  tfidf: {},
  lightweight: {},
  minilm: {},
  openai: { requiresKey: true, keyField: 'openaiApiKey' },
  gemini: { requiresKey: true, keyField: 'geminiApiKey' }
};

function issue(level: ValidationLevel, code: string, message: string, suggestion?: string): ConfigValidationIssue {
  return { level, code, message, suggestion };
}

export function validateConfiguration(config: MementoConfig, options: ValidateOptions = {}): ConfigValidationResult {
  const errors: ConfigValidationIssue[] = [];
  const warnings: ConfigValidationIssue[] = [];

  const logger = options.logger ?? console;

  if (!config.dbPath || config.dbPath.trim() === '') {
    errors.push(
      issue('error', 'DB_PATH_EMPTY', 'DB_PATH가 비어 있습니다.', '데이터베이스 파일 경로를 설정해주세요.')
    );
  }

  if (!Number.isFinite(config.port) || config.port <= 0 || config.port > 65535) {
    errors.push(
      issue('error', 'PORT_INVALID', `포트 번호(${config.port})가 유효하지 않습니다.`, '1~65535 범위의 정수를 사용해주세요.')
    );
  }

  const rawPort = getRawEnvValue('PORT');
  const rawMcpPort = getRawEnvValue('MCP_SERVER_PORT');
  if (
    rawPort &&
    rawMcpPort &&
    rawPort.trim() !== '' &&
    rawMcpPort.trim() !== '' &&
    rawPort !== rawMcpPort
  ) {
    warnings.push(
      issue(
        'warning',
        'PORT_MISMATCH',
        `PORT(${rawPort})와 MCP_SERVER_PORT(${rawMcpPort}) 값이 다릅니다.`,
        '컨테이너 포트를 예측 가능하게 유지하려면 동일한 값을 사용해주세요.'
      )
    );
  }

  const provider = config.embeddingProvider;
  const requirement = providerRequirements[provider];
  if (!requirement) {
    errors.push(
      issue(
        'error',
        'PROVIDER_UNKNOWN',
        `알 수 없는 임베딩 제공자: ${provider}.`,
        'tfidf, lightweight, minilm, openai, gemini 중 하나를 사용해주세요.'
      )
    );
  } else if (requirement.requiresKey && requirement.keyField) {
    const keyField = requirement.keyField;
    const apiKey = config[keyField];
    if (!apiKey || apiKey.trim() === '') {
      errors.push(
        issue(
          'error',
          'PROVIDER_API_KEY_MISSING',
          `${provider} 제공자를 사용하려면 ${requirement.keyField}가 필요합니다.`,
          'API 키를 설정하거나 EMBEDDING_PROVIDER를 minilm/tfidf와 같은 로컬 모델로 전환해주세요.'
        )
      );
    }
  }

  if (!Number.isFinite(config.embeddingDimensions) || config.embeddingDimensions <= 0) {
    errors.push(
      issue(
        'error',
        'EMBEDDING_DIMENSIONS_INVALID',
        `임베딩 차원(${config.embeddingDimensions})이 올바르지 않습니다.`,
        '양수 값을 지정해주세요.'
      )
    );
  } else {
    const expected =
      providerDimensionDefaults[provider as keyof typeof providerDimensionDefaults] ?? undefined;
    if (typeof expected === 'number' && expected > 0 && config.embeddingDimensions !== expected) {
      warnings.push(
        issue(
          'warning',
          'EMBEDDING_DIMENSIONS_MISMATCH',
          `${provider} 권장 차원은 ${expected}이지만 현재 설정은 ${config.embeddingDimensions}입니다.`,
          '권장 차원을 사용하여 검색 성능을 최적화하는 것을 권장합니다.'
        )
      );
    }
  }

  if (config.searchDefaultLimit <= 0 || config.searchMaxLimit <= 0) {
    errors.push(
      issue('error', 'SEARCH_LIMIT_INVALID', '검색 제한 값은 양수여야 합니다.', '양수 값을 설정해주세요.')
    );
  } else if (config.searchDefaultLimit > config.searchMaxLimit) {
    errors.push(
      issue(
        'error',
        'SEARCH_LIMIT_RELATION_INVALID',
        `SEARCH_DEFAULT_LIMIT(${config.searchDefaultLimit})이 SEARCH_MAX_LIMIT(${config.searchMaxLimit})보다 클 수 없습니다.`,
        'SEARCH_MAX_LIMIT을 더 크게 설정하거나 기본 제한을 줄여주세요.'
      )
    );
  }

  const ttlEntries: Array<[keyof MementoConfig['forgetTTL'], number]> = [
    ['working', config.forgetTTL.working],
    ['episodic', config.forgetTTL.episodic],
    ['semantic', config.forgetTTL.semantic],
    ['procedural', config.forgetTTL.procedural]
  ];

  for (const [key, value] of ttlEntries) {
    const isAlwaysRetain = key === 'semantic' || key === 'procedural';
    if (!Number.isFinite(value)) {
      errors.push(
        issue(
          'error',
          'TTL_NOT_A_NUMBER',
          `${key} TTL 값이 숫자가 아닙니다.`,
          '시간(시간 단위)을 나타내는 정수를 사용해주세요.'
        )
      );
      continue;
    }

    if (value < 0 && !isAlwaysRetain) {
      errors.push(
        issue(
          'error',
          'TTL_NEGATIVE',
          `${key} TTL(${value})은 음수가 될 수 없습니다.`,
          '0보다 큰 값을 사용하거나 무기한 유지가 필요하면 semantic/procedural에 -1을 사용해주세요.'
        )
      );
    }
  }

  if (!config.logLevel || config.logLevel.trim() === '') {
    warnings.push(
      issue('warning', 'LOG_LEVEL_EMPTY', 'LOG_LEVEL이 비어있습니다.', 'info, warn, error 등 유효한 레벨을 설정해주세요.')
    );
  } else if (
    config.nodeEnv === 'production' &&
    ['debug', 'trace', 'silly', 'verbose'].includes(config.logLevel.toLowerCase())
  ) {
    warnings.push(
      issue(
        'warning',
        'LOG_LEVEL_VERBOSE_IN_PRODUCTION',
        `프로덕션 환경에서 로그 레벨이 ${config.logLevel}로 설정되어 있습니다.`,
        'log level을 info 이상으로 조정해 불필요한 로그를 줄이는 것을 권장합니다.'
      )
    );
  }

  const result: ConfigValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings
  };

  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warn?.(`[config][${warning.code}] ${warning.message}`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      logger.error?.(`[config][${error.code}] ${error.message}`);
    }
    if (options.throwOnError ?? true) {
      const message = errors.map(err => `[${err.code}] ${err.message}`).join('\n');
      throw new Error(`환경 설정 검증 실패:\n${message}`);
    }
  }

  return result;
}
