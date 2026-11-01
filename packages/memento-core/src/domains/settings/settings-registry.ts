/**
 * #1582: 화면에서 바꿀 수 있는 설정 키의 표. 키마다 분기하지 않고 이 표만 읽는다.
 *
 * override 값은 env 와 같은 정규 문자열로 저장한다. 적용은 process.env 에 쓴 뒤 refresh() 로
 * mementoConfig 를 부팅 때와 같은 파서로 다시 계산한다. 비밀값, 인프라, 임베딩 모델은 표에 두지 않는다.
 */
import type { MementoConfig } from '../../shared/types/memory.types.js';
import { DEFAULT_RELEVANCE_GATE_THRESHOLD } from '../../shared/config/constants.js';
import {
  mementoConfig,
  resolveProceduralExtractionStrategy,
  resolveRejectionGateOnError,
  resolveRejectionGateProvider,
  resolveRejectionGateThreshold,
} from '../../shared/config/index.js';
import { getRawEnvValue, resolveBoolean, resolveOptionalString } from '../../shared/config/environment.js';
import {
  parseRelationExtractionOverride,
  syncRelationExtractionProvider,
} from '../../shared/config/relation-extraction-seat.js';
import { parseRememberDedupMode } from '../../shared/utils/remember-dedup-config.js';

export interface RuntimeSettingDefinition {
  readonly key: string;
  readonly kind: 'enum' | 'number' | 'boolean' | 'string';
  readonly allowed?: readonly string[];
  readonly range?: { readonly min: number; readonly max: number; readonly minExclusive?: boolean };
  readonly pattern?: RegExp;
  /** 코드 기본값. null 이면 미설정일 때 상위 설정(전역 LLM_PROVIDER 등)을 따른다. */
  readonly defaultValue: string | null;
  readonly defaultSource: string;
  /** immediate: 코드가 매 요청/배치마다 읽는다. restart: 부팅 때 한 번 읽는다(재적용 훅은 #1583 이후). */
  readonly apply: 'immediate' | 'restart';
  readonly risk: 'low' | 'medium' | 'high';
  /** process.env 에서 mementoConfig 필드를 다시 계산한다. 코드가 process.env 를 직접 읽는 키는 비워 둔다. */
  readonly refresh: () => void;
}

export interface ReadOnlySettingDefinition {
  readonly key: string;
  readonly secret: boolean;
  /** 있으면 env 대신 이 mementoConfig 필드의 실효값을 보여 준다. */
  readonly config?: keyof MementoConfig;
}

const readsEnvDirectly = (): void => {};
const boolean = ['true', 'false'] as const;

const DEFINITIONS: readonly RuntimeSettingDefinition[] = [
  {
    key: 'SEARCH_REJECTION_GATE',
    kind: 'enum',
    allowed: ['off', 'typesafe', 'ollama'],
    defaultValue: 'off',
    defaultSource: 'shared/config/environment.ts ENV_DEFAULTS',
    apply: 'restart',
    risk: 'medium',
    refresh: () => {
      mementoConfig.searchRejectionGate = resolveRejectionGateProvider();
    },
  },
  {
    key: 'SEARCH_REJECTION_GATE_THRESHOLD',
    kind: 'number',
    range: { min: 0, max: 1 },
    defaultValue: String(DEFAULT_RELEVANCE_GATE_THRESHOLD),
    defaultSource: 'shared/config/constants.ts DEFAULT_RELEVANCE_GATE_THRESHOLD',
    apply: 'immediate',
    risk: 'medium',
    refresh: () => {
      mementoConfig.searchRejectionGateThreshold = resolveRejectionGateThreshold();
    },
  },
  {
    key: 'SEARCH_REJECTION_GATE_ON_ERROR',
    kind: 'enum',
    allowed: ['open', 'closed'],
    defaultValue: 'open',
    defaultSource: 'shared/config/environment.ts ENV_DEFAULTS',
    apply: 'immediate',
    risk: 'medium',
    refresh: () => {
      mementoConfig.searchRejectionGateOnError = resolveRejectionGateOnError();
    },
  },
  {
    key: 'CONSOLIDATION_JUDGE',
    kind: 'enum',
    allowed: ['off', 'typesafe'],
    defaultValue: 'off',
    defaultSource: 'domains/consolidation/services/cluster-judge.ts',
    apply: 'restart',
    risk: 'low',
    refresh: readsEnvDirectly,
  },
  {
    key: 'CONSOLIDATION_JUDGE_THRESHOLD',
    kind: 'number',
    range: { min: 0, max: 1, minExclusive: true },
    defaultValue: '0.6',
    defaultSource: 'domains/consolidation/services/cluster-judge.ts getClusterJudgeThreshold',
    apply: 'immediate',
    risk: 'low',
    refresh: readsEnvDirectly,
  },
  {
    key: 'LLM_PROVIDER_RELATION_EXTRACTION',
    kind: 'enum',
    // ponytail: chat 값 목록은 llm-provider-override.ts 와 같아야 하며 spec 이 파서와 대조한다.
    allowed: ['jev', 'openai', 'gemini', 'ollama', 'auto'],
    defaultValue: null,
    defaultSource: '전역 LLM_PROVIDER',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      const override = parseRelationExtractionOverride(getRawEnvValue('LLM_PROVIDER_RELATION_EXTRACTION'));
      mementoConfig.relationExtractionOverride = override;
      syncRelationExtractionProvider(mementoConfig.llmProviderOverrides, override);
    },
  },
  {
    key: 'LLM_MODEL_RELATION_EXTRACTION',
    kind: 'string',
    pattern: /^[A-Za-z0-9._:/-]{1,128}$/,
    defaultValue: null,
    defaultSource: '제공자별 기본 모델(resolveLlmModel)',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.llmModelOverrides.relation_extraction = resolveOptionalString('LLM_MODEL_RELATION_EXTRACTION');
    },
  },
  {
    key: 'SUPERSEDE_CANDIDATE_SCAN_ENABLED',
    kind: 'boolean',
    allowed: boolean,
    defaultValue: 'false',
    defaultSource: 'infrastructure/scheduler/batch-scheduler/batch-scheduler-default-config.ts',
    apply: 'restart',
    risk: 'low',
    refresh: readsEnvDirectly,
  },
  {
    key: 'SUPERSEDE_APPLY_ENABLED',
    kind: 'boolean',
    allowed: boolean,
    defaultValue: 'false',
    defaultSource: 'shared/config/index.ts',
    apply: 'immediate',
    risk: 'medium',
    refresh: () => {
      mementoConfig.supersedeApplyEnabled = resolveBoolean('SUPERSEDE_APPLY_ENABLED', { defaultValue: false });
    },
  },
  {
    key: 'REFLEXION_OBSERVATION_ONLY',
    kind: 'boolean',
    allowed: boolean,
    defaultValue: 'false',
    defaultSource: 'shared/config/index.ts',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.reflexionObservationOnly = resolveBoolean('REFLEXION_OBSERVATION_ONLY', { defaultValue: false });
    },
  },
  {
    key: 'PROCEDURAL_EXTRACTION_STRATEGY',
    kind: 'enum',
    allowed: ['rule_only', 'llm_first'],
    defaultValue: 'rule_only',
    defaultSource: 'shared/config/index.ts',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.proceduralExtractionStrategy = resolveProceduralExtractionStrategy();
    },
  },
  {
    key: 'MEMENTO_REMEMBER_DEDUP_MODE',
    kind: 'enum',
    allowed: ['warn', 'strict', 'off'],
    defaultValue: 'warn',
    defaultSource: 'shared/utils/remember-dedup-config.ts',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.rememberDedupMode = parseRememberDedupMode(getRawEnvValue('MEMENTO_REMEMBER_DEDUP_MODE'));
    },
  },
];

export const SETTING_REGISTRY: ReadonlyMap<string, RuntimeSettingDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.key, definition]),
);

export const READ_ONLY_SETTINGS: readonly ReadOnlySettingDefinition[] = [
  { key: 'ADMIN_API_KEY', secret: true, config: 'adminApiKey' },
  { key: 'MEMENTO_API_TOKENS', secret: true },
  { key: 'OPENAI_API_KEY', secret: true, config: 'openaiApiKey' },
  { key: 'GEMINI_API_KEY', secret: true, config: 'geminiApiKey' },
  { key: 'TYPESAFE_API_KEY', secret: true, config: 'typesafeApiKey' },
  { key: 'EMBEDDING_PROVIDER', secret: false, config: 'embeddingProvider' },
  { key: 'EMBEDDING_DIMENSIONS', secret: false, config: 'embeddingDimensions' },
  { key: 'LLM_PROVIDER', secret: false, config: 'llmProvider' },
  { key: 'OPENAI_LLM_MODEL', secret: false, config: 'openaiLlmModel' },
  { key: 'GEMINI_LLM_MODEL', secret: false, config: 'geminiLlmModel' },
  { key: 'OLLAMA_MODEL', secret: false, config: 'ollamaModel' },
  { key: 'TYPESAFE_MODEL', secret: false, config: 'typesafeModel' },
  { key: 'MEMENTO_MCP_ERA', secret: false, config: 'mcpEra' },
  { key: 'MEMENTO_TOOLSET', secret: false },
  { key: 'MEMENTO_OWNER_SCOPE_MODE', secret: false, config: 'ownerScopeMode' },
  { key: 'ENABLE_PII_MASKING', secret: false },
  { key: 'MEMENTO_OFFLINE_STRICT', secret: false, config: 'offlineStrict' },
  { key: 'ADMIN_JOBS_READ_ONLY', secret: false, config: 'adminJobsReadOnly' },
];

const DECIMAL = /^\d+(?:\.\d+)?$/;

export type NormalizedSettingValue = { value: string } | { message: string };

/** 저장할 정규 문자열을 돌려준다. 형식이 맞지 않으면 허용 범위를 담은 메시지를 돌려준다. */
export function normalizeSettingValue(definition: RuntimeSettingDefinition, raw: unknown): NormalizedSettingValue {
  const refuse = (message: string): NormalizedSettingValue => ({ message: `${definition.key} ${message}` });
  if (typeof raw !== 'string') {
    return refuse('value must be a string');
  }
  if (definition.allowed) {
    return definition.allowed.includes(raw)
      ? { value: raw }
      : refuse(`must be one of: ${definition.allowed.join(', ')}`);
  }
  if (definition.kind === 'number' && definition.range) {
    const { min, max, minExclusive } = definition.range;
    const parsed = Number(raw);
    const inRange = parsed <= max && (minExclusive ? parsed > min : parsed >= min);
    return raw.length <= 32 && DECIMAL.test(raw) && inRange
      ? { value: String(parsed) }
      : refuse(`must be a decimal number in ${minExclusive ? '(' : '['}${min}, ${max}]`);
  }
  if (definition.pattern) {
    return definition.pattern.test(raw) ? { value: raw } : refuse(`must match ${definition.pattern}`);
  }
  return refuse('has no validation rule');
}
