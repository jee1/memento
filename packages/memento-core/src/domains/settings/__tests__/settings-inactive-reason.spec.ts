import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'SEARCH_REJECTION_GATE',
  'CONSOLIDATION_JUDGE',
  'LLM_PROVIDER_RELATION_EXTRACTION',
] as const;
const savedEnv = new Map<string, string | undefined>();

async function load() {
  vi.resetModules();
  const registry = await import('../settings-registry.js');
  const { mementoConfig } = await import('../../../shared/config/index.js');
  return { ...registry, setApiKey: (key: string) => { mementoConfig.typesafeApiKey = key; } };
}

/** 상위 스위치 env 를 바꾸고 그 키의 refresh 를 돌린 뒤, 종속 키의 inactiveReason 을 읽는다. */
function reasonAfter(
  registry: Awaited<ReturnType<typeof load>>,
  env: Record<string, string>,
  switchKey: string,
  dependentKey: string,
): string | null {
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  registry.SETTING_REGISTRY.get(switchKey)!.refresh();
  return registry.SETTING_REGISTRY.get(dependentKey)!.inactiveReason!();
}

describe('settings inactive reason (#1685)', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it.each([
    'SEARCH_REJECTION_GATE_THRESHOLD',
    'SEARCH_REJECTION_GATE_ON_ERROR',
    'MEMORY_INJECTION_ITEM_SCORE_MIN',
  ])('%s is inactive while the rejection gate is off or ollama, active with typesafe', async (dependent) => {
    const registry = await load();
    registry.setApiKey('k');
    const reason = (gate: string) =>
      reasonAfter(registry, { SEARCH_REJECTION_GATE: gate }, 'SEARCH_REJECTION_GATE', dependent);
    expect(reason('off')).toContain('SEARCH_REJECTION_GATE 가 off 다');
    expect(reason('ollama')).toContain('ollama');
    expect(reason('typesafe')).toBeNull();
    expect(reason('off')).not.toBeNull();
  });

  it('CONSOLIDATION_JUDGE_THRESHOLD is inactive while the judge is off, active with typesafe', async () => {
    const registry = await load();
    registry.setApiKey('k');
    const reason = (judge: string) =>
      reasonAfter(
        registry,
        { CONSOLIDATION_JUDGE: judge },
        'CONSOLIDATION_JUDGE',
        'CONSOLIDATION_JUDGE_THRESHOLD',
      );
    expect(reason('off')).toContain('CONSOLIDATION_JUDGE 가 off 다');
    expect(reason('typesafe')).toBeNull();
    expect(reason('off')).not.toBeNull();
  });

  it('typesafe without TYPESAFE_API_KEY is inactive: the gate and the judge are never built (#1685 review)', async () => {
    const registry = await load();
    const gate = (key: string) => {
      registry.setApiKey(key);
      return reasonAfter(registry, { SEARCH_REJECTION_GATE: 'typesafe' }, 'SEARCH_REJECTION_GATE', 'SEARCH_REJECTION_GATE_THRESHOLD');
    };
    expect(gate('')).toContain('TYPESAFE_API_KEY');
    expect(gate('   ')).toContain('TYPESAFE_API_KEY');
    expect(gate('k')).toBeNull();
    const judge = (key: string) => {
      registry.setApiKey(key);
      return reasonAfter(registry, { CONSOLIDATION_JUDGE: 'typesafe' }, 'CONSOLIDATION_JUDGE', 'CONSOLIDATION_JUDGE_THRESHOLD');
    };
    expect(judge('')).toContain('TYPESAFE_API_KEY');
    expect(judge('k')).toBeNull();
  });

  it('LLM_MODEL_RELATION_EXTRACTION is inactive under jev, active under chat providers or unset', async () => {
    const registry = await load();
    const reason = (provider: string | null) => {
      if (provider === null) delete process.env.LLM_PROVIDER_RELATION_EXTRACTION;
      return reasonAfter(
        registry,
        provider === null ? {} : { LLM_PROVIDER_RELATION_EXTRACTION: provider },
        'LLM_PROVIDER_RELATION_EXTRACTION',
        'LLM_MODEL_RELATION_EXTRACTION',
      );
    };
    expect(reason('jev')).toContain('TYPESAFE_MODEL');
    expect(reason('jev')).toContain('typesafe');
    for (const provider of ['openai', 'gemini', 'ollama', 'auto']) {
      expect(reason(provider), provider).toBeNull();
    }
    expect(reason('jev')).not.toBeNull();
    expect(reason(null)).toBeNull();
  });

  it('only the five masked keys define a rule; the other eight never report inactive', async () => {
    const { SETTING_REGISTRY } = await load();
    const withRule = [...SETTING_REGISTRY.values()].filter((d) => d.inactiveReason).map((d) => d.key);
    expect(withRule.sort()).toEqual([
      'CONSOLIDATION_JUDGE_THRESHOLD',
      'LLM_MODEL_RELATION_EXTRACTION',
      'MEMORY_INJECTION_ITEM_SCORE_MIN',
      'SEARCH_REJECTION_GATE_ON_ERROR',
      'SEARCH_REJECTION_GATE_THRESHOLD',
    ]);
  });
});
