import type {
  AgentEventEnvelope,
  RedactionCount,
  RedactionRule,
} from './types.js';

type RedactionResult =
  | {
    action: 'ACCEPTED' | 'REDACTED';
    event: AgentEventEnvelope;
    metadata: RedactionCount[];
  }
  | {
    action: 'DROPPED';
    reason: 'PRIVATE_KEY_MATERIAL' | 'SENSITIVE_PATH' | 'BINARY_CONTENT';
    metadata: RedactionCount[];
  };

type BlockingRule = 'PRIVATE_KEY_MATERIAL' | 'SENSITIVE_PATH' | 'BINARY_CONTENT';

const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i;
const SENSITIVE_PATHS = [
  /(?:^|[/\\])\.env(?:\.[^/\\]+)?$/i,
  /(?:^|[/\\])\.ssh[/\\]/i,
  /(?:^|[/\\])(?:\.aws|\.config[/\\]gcloud|\.azure)[/\\]/i,
  /(?:^|[/\\])(?:\.npmrc|\.pypirc|\.git-credentials|kubeconfig)$/i,
  /service-account[^/\\]*\.json$/i,
];
const KEY_RULES: Array<[RegExp, RedactionRule]> = [
  [/(?:^|_)api_?key(?:$|_)/i, 'API_KEY'],
  [/(?:^|_)token(?:$|_)/i, 'TOKEN'],
  [/(?:^|_)password(?:$|_)/i, 'PASSWORD'],
  [/(?:^|_)credential(?:s)?(?:$|_)/i, 'CREDENTIAL'],
];
const NON_SECRET_CONTROL_KEYS = new Set(['token_budget']);
const INLINE_RULES: Array<[RedactionRule, RegExp]> = [
  ['API_KEY', /\b(?:sk|pk)(?:[_-](?:live|test|proj))?[_-][A-Za-z0-9_-]{16,}\b/g],
  ['TOKEN', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g],
  ['EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
  ['PHONE', /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}(?!\w)/g],
  ['HIGH_ENTROPY_SECRET', /\b(?=[A-Za-z0-9]{32,}\b)(?=[A-Za-z0-9]*[A-Z])(?=[A-Za-z0-9]*[a-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]+\b/g],
];

function increment(counts: Map<RedactionRule, number>, rule: RedactionRule, count = 1): void {
  counts.set(rule, (counts.get(rule) ?? 0) + count);
}

function metadata(counts: Map<RedactionRule, number>): RedactionCount[] {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rule, count]) => ({ rule, count }));
}

function scanBlocked(value: unknown): BlockingRule | undefined {
  if (typeof value === 'string') {
    if (value.includes('\u0000')) return 'BINARY_CONTENT';
    if (PRIVATE_KEY.test(value)) return 'PRIVATE_KEY_MATERIAL';
    if (SENSITIVE_PATHS.some((pattern) => pattern.test(value))) return 'SENSITIVE_PATH';
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const blocked = scanBlocked(item);
      if (blocked) return blocked;
    }
    return undefined;
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      const blocked = scanBlocked(item);
      if (blocked) return blocked;
    }
  }
  return undefined;
}

function redactString(value: string, counts: Map<RedactionRule, number>): string {
  let redacted = value;
  for (const [rule, pattern] of INLINE_RULES) {
    redacted = redacted.replace(pattern, () => {
      increment(counts, rule);
      return `[REDACTED:${rule}]`;
    });
  }
  return redacted;
}

function redactValue(
  value: unknown,
  counts: Map<RedactionRule, number>,
  key?: string,
): unknown {
  if (key && !NON_SECRET_CONTROL_KEYS.has(key)) {
    const keyRule = KEY_RULES.find(([pattern]) => pattern.test(key))?.[1];
    if (keyRule && value !== undefined) {
      increment(counts, keyRule);
      return `[REDACTED:${keyRule}]`;
    }
  }
  if (typeof value === 'string') return redactString(value, counts);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, counts));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, item]) => [
        entryKey,
        redactValue(item, counts, entryKey),
      ]),
    );
  }
  return value;
}

export function redactAgentEvent(event: AgentEventEnvelope): RedactionResult {
  const blocked = scanBlocked(event.payload);
  if (blocked) {
    return {
      action: 'DROPPED',
      reason: blocked,
      metadata: [{ rule: blocked, count: 1 }],
    };
  }

  const counts = new Map<RedactionRule, number>();
  const redacted = redactValue(event, counts) as AgentEventEnvelope;
  return {
    action: counts.size === 0 ? 'ACCEPTED' : 'REDACTED',
    event: redacted,
    metadata: metadata(counts),
  };
}
