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
import { getClusterJudgeThreshold, isClusterJudgeEnabled } from '../../shared/config/cluster-judge-config.js';

export interface RuntimeSettingDefinition {
  readonly key: string;
  /** 화면에 보이는 한국어 한 문장. 키가 무엇을 바꾸는지 적는다. */
  readonly description: string;
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
  /** 코드가 지금 쓰는 값의 정규 문자열. env 가 비정규거나 무효여도 실제로 해석된 값을 돌려준다. null 은 상위 설정을 따름. */
  readonly current: () => string | null;
}

export interface ReadOnlySettingDefinition {
  readonly key: string;
  readonly secret: boolean;
  /** 있으면 env 대신 이 mementoConfig 필드의 실효값을 보여 준다. */
  readonly config?: keyof MementoConfig;
}

const readsEnvDirectly = (): void => {};

function relationExtractionValue(override: MementoConfig['relationExtractionOverride']): string | null {
  if (override.kind === 'chat') return override.provider;
  return override.kind === 'jev' ? 'jev' : null;
}
const boolean = ['true', 'false'] as const;

const DEFINITIONS: readonly RuntimeSettingDefinition[] = [
  {
    key: 'SEARCH_REJECTION_GATE',
    description: '무관한 질의를 검색 단계에서 거부하는 게이트의 판정 방식을 고른다. off 면 거부하지 않는다.',
    kind: 'enum',
    allowed: ['off', 'typesafe', 'ollama'],
    defaultValue: 'off',
    defaultSource: 'shared/config/environment.ts ENV_DEFAULTS',
    apply: 'immediate',
    risk: 'medium',
    refresh: () => {
      mementoConfig.searchRejectionGate = resolveRejectionGateProvider();
    },
    current: () => mementoConfig.searchRejectionGate,
  },
  {
    key: 'SEARCH_REJECTION_GATE_THRESHOLD',
    description: '상위 후보의 최고 점수가 이 값보다 낮으면 질의를 거부한다(0~1). 높일수록 더 많이 거부한다.',
    kind: 'number',
    range: { min: 0, max: 1 },
    defaultValue: String(DEFAULT_RELEVANCE_GATE_THRESHOLD),
    defaultSource: 'shared/config/constants.ts DEFAULT_RELEVANCE_GATE_THRESHOLD',
    apply: 'immediate',
    risk: 'medium',
    refresh: () => {
      mementoConfig.searchRejectionGateThreshold = resolveRejectionGateThreshold();
    },
    current: () => String(mementoConfig.searchRejectionGateThreshold),
  },
  {
    key: 'SEARCH_REJECTION_GATE_ON_ERROR',
    description: '게이트가 점수를 하나도 얻지 못했을 때 질의를 통과시킬지(open) 거부할지(closed) 정한다.',
    kind: 'enum',
    allowed: ['open', 'closed'],
    defaultValue: 'open',
    defaultSource: 'shared/config/environment.ts ENV_DEFAULTS',
    apply: 'immediate',
    risk: 'medium',
    refresh: () => {
      mementoConfig.searchRejectionGateOnError = resolveRejectionGateOnError();
    },
    current: () => mementoConfig.searchRejectionGateOnError,
  },
  {
    key: 'CONSOLIDATION_JUDGE',
    description: '통합 후보 군집을 LLM 이 판정하는 단계를 켠다. off 면 판정 없이 진행한다.',
    kind: 'enum',
    allowed: ['off', 'typesafe'],
    defaultValue: 'off',
    defaultSource: 'shared/config/cluster-judge-config.ts isClusterJudgeEnabled',
    apply: 'immediate',
    risk: 'low',
    refresh: readsEnvDirectly,
    current: () => (isClusterJudgeEnabled() ? 'typesafe' : 'off'),
  },
  {
    key: 'CONSOLIDATION_JUDGE_THRESHOLD',
    description: '통합 후보 군집 판정에서 통과로 보는 신뢰도 기준값(0 초과 1 이하).',
    kind: 'number',
    range: { min: 0, max: 1, minExclusive: true },
    defaultValue: '0.6',
    defaultSource: 'shared/config/cluster-judge-config.ts getClusterJudgeThreshold',
    apply: 'immediate',
    risk: 'low',
    refresh: readsEnvDirectly,
    current: () => String(getClusterJudgeThreshold()),
  },
  {
    key: 'LLM_PROVIDER_RELATION_EXTRACTION',
    description: '관계 추출에 쓰는 LLM 제공자를 고른다. 비우면 전역 LLM_PROVIDER 를 따른다.',
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
    current: () => relationExtractionValue(mementoConfig.relationExtractionOverride),
  },
  {
    key: 'LLM_MODEL_RELATION_EXTRACTION',
    description: '관계 추출에 쓰는 LLM 모델 이름을 고른다. 비우면 제공자 기본 모델을 쓴다.',
    kind: 'string',
    pattern: /^[A-Za-z0-9._:/-]{1,128}$/,
    defaultValue: null,
    defaultSource: '제공자별 기본 모델(resolveLlmModel)',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.llmModelOverrides.relation_extraction = resolveOptionalString('LLM_MODEL_RELATION_EXTRACTION');
    },
    current: () => mementoConfig.llmModelOverrides.relation_extraction ?? null,
  },
  {
    key: 'SUPERSEDE_CANDIDATE_SCAN_ENABLED',
    description: '대체 후보를 찾는 배치 스캔을 켠다. 후보만 만들고 기억은 바꾸지 않는다.',
    kind: 'boolean',
    allowed: boolean,
    defaultValue: 'false',
    defaultSource: 'infrastructure/scheduler/batch-scheduler/batch-scheduler-default-config.ts',
    apply: 'immediate',
    risk: 'low',
    refresh: readsEnvDirectly,
    current: () => String(resolveBoolean('SUPERSEDE_CANDIDATE_SCAN_ENABLED', { defaultValue: false })),
  },
  {
    key: 'SUPERSEDE_APPLY_ENABLED',
    description: '사람이 승인한 대체 후보를 실제 기억에 적용하는 API 를 연다. 꺼져 있으면 승인이 403 으로 거절된다.',
    kind: 'boolean',
    allowed: boolean,
    defaultValue: 'false',
    defaultSource: 'shared/config/index.ts',
    apply: 'immediate',
    risk: 'medium',
    refresh: () => {
      mementoConfig.supersedeApplyEnabled = resolveBoolean('SUPERSEDE_APPLY_ENABLED', { defaultValue: false });
    },
    current: () => String(mementoConfig.supersedeApplyEnabled),
  },
  {
    key: 'REFLEXION_OBSERVATION_ONLY',
    description: 'reflexion 이 실패 회고를 검증 전 후보 기억으로만 남기고 기존 절차 기억은 고치지 않게 한다.',
    kind: 'boolean',
    allowed: boolean,
    defaultValue: 'false',
    defaultSource: 'shared/config/index.ts',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.reflexionObservationOnly = resolveBoolean('REFLEXION_OBSERVATION_ONLY', { defaultValue: false });
    },
    current: () => String(mementoConfig.reflexionObservationOnly),
  },
  {
    key: 'PROCEDURAL_EXTRACTION_STRATEGY',
    description: '절차 기억 추출 순서를 정한다. rule_only 는 규칙만, llm_first 는 LLM 을 먼저 쓴다.',
    kind: 'enum',
    allowed: ['rule_only', 'llm_first'],
    defaultValue: 'rule_only',
    defaultSource: 'shared/config/index.ts',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.proceduralExtractionStrategy = resolveProceduralExtractionStrategy();
    },
    current: () => mementoConfig.proceduralExtractionStrategy,
  },
  {
    key: 'MEMENTO_REMEMBER_DEDUP_MODE',
    description: 'remember 가 중복 기억을 만났을 때 경고만(warn), 거절(strict), 검사 안 함(off) 중 하나로 처리한다.',
    kind: 'enum',
    allowed: ['warn', 'strict', 'off'],
    defaultValue: 'warn',
    defaultSource: 'shared/utils/remember-dedup-config.ts',
    apply: 'immediate',
    risk: 'low',
    refresh: () => {
      mementoConfig.rememberDedupMode = parseRememberDedupMode(getRawEnvValue('MEMENTO_REMEMBER_DEDUP_MODE'));
    },
    current: () => mementoConfig.rememberDedupMode,
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
