/**
 * CLI 옵션 → MCP 도구 인자 변환
 * 명세: REQ-TOOL-1. 서브커맨드별 --key val → params 매핑 (inputSchema 기반)
 */

/** argv[3..] 구간에서 --key value 쌍 파싱. 쉼표 구분 문자열은 배열로 변환. */
export function parseArgvToParams(argv: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--') && arg.length > 2) {
      const key = arg.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        params[key] = true;
        i += 1;
        continue;
      }
      const raw = next;
      if (raw === 'true') params[key] = true;
      else if (raw === 'false') params[key] = false;
      else if (raw.includes(',') && !raw.startsWith('"') && !raw.startsWith("'")) {
        params[key] = raw.split(',').map((s) => s.trim()).filter(Boolean);
      } else if (Number.isFinite(Number(raw))) {
        params[key] = Number(raw);
      } else {
        params[key] = raw;
      }
      i += 2;
      continue;
    }
    i += 1;
  }
  return params;
}

/** recall: query 필수, limit 등 선택. MCP inputSchema와 동일 키. */
export function recallParams(argv: string[]): Record<string, unknown> {
  const p = parseArgvToParams(argv);
  const out: Record<string, unknown> = {};
  if (typeof p.query === 'string') out.query = p.query;
  if (typeof p.limit === 'number') out.limit = p.limit;
  else out.limit = 10;
  if (typeof p.type === 'string') out.type = p.type;
  if (Array.isArray(p.memory_types)) out.memory_types = p.memory_types;
  if (Array.isArray(p.tags)) out.tags = p.tags;
  if (typeof p.time_from === 'string') out.time_from = p.time_from;
  if (typeof p.time_to === 'string') out.time_to = p.time_to;
  if (typeof p.pinned === 'boolean') out.pinned = p.pinned;
  if (typeof p.importance_min === 'number') out.importance_min = p.importance_min;
  if (typeof p.importance_max === 'number') out.importance_max = p.importance_max;
  if (typeof p.vector_weight === 'number') out.vector_weight = p.vector_weight;
  if (typeof p.text_weight === 'number') out.text_weight = p.text_weight;
  if (typeof p.enable_hybrid === 'boolean') out.enable_hybrid = p.enable_hybrid;
  if (typeof p.include_metadata === 'boolean') out.include_metadata = p.include_metadata;
  if (typeof p.auto_set_anchor === 'boolean') out.auto_set_anchor = p.auto_set_anchor;
  if (typeof p.include_neighbors === 'boolean') out.include_neighbors = p.include_neighbors;
  if (typeof p.agent_id === 'string') out.agent_id = p.agent_id;
  if (Array.isArray(p.privacy_scope)) out.privacy_scope = p.privacy_scope;
  return out;
}

/** remember: content 필수, type, tags, importance, privacy_scope 등. */
export function rememberParams(argv: string[]): Record<string, unknown> {
  const p = parseArgvToParams(argv);
  const out: Record<string, unknown> = {};
  if (typeof p.content === 'string') out.content = p.content;
  if (typeof p.type === 'string') out.type = p.type;
  if (Array.isArray(p.tags)) out.tags = p.tags;
  if (typeof p.importance === 'number') out.importance = p.importance;
  if (typeof p.privacy_scope === 'string') out.privacy_scope = p.privacy_scope;
  if (typeof p.source === 'string') out.source = p.source;
  return out;
}

/** forget: id 또는 batch 필수, hard, reason, confirm. 명세: --id와 --memory-id 둘 다 주어지면 --memory-id 우선. */
export function forgetParams(argv: string[]): Record<string, unknown> {
  const p = parseArgvToParams(argv);
  const out: Record<string, unknown> = {};
  if (typeof p.id === 'string') out.id = p.id;
  if (typeof p.memory_id === 'string') out.id = p.memory_id; // 우선: --memory-id가 있으면 덮어씀
  if (Array.isArray(p.batch)) out.batch = p.batch;
  if (typeof p.hard === 'boolean') out.hard = p.hard;
  if (typeof p.reason === 'string') out.reason = p.reason;
  if (typeof p.confirm === 'boolean') out.confirm = p.confirm;
  return out;
}

/** memory_injection: query 필수, token_budget, max_memories, memory_types, importance_threshold. */
export function memoryInjectionParams(argv: string[]): Record<string, unknown> {
  const p = parseArgvToParams(argv);
  const out: Record<string, unknown> = {};
  if (typeof p.query === 'string') out.query = p.query;
  if (typeof p.token_budget === 'number') out.token_budget = p.token_budget;
  if (typeof p.max_memories === 'number') out.max_memories = p.max_memories;
  if (Array.isArray(p.memory_types)) out.memory_types = p.memory_types;
  if (typeof p.importance_threshold === 'number') out.importance_threshold = p.importance_threshold;
  return out;
}
