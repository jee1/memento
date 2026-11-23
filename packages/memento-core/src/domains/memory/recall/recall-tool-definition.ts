/**
 * Recall MCP JSON 입력 스키마 (recall-tool.ts constructor에서 분리, #445).
 * Zod 검증은 recall-tool-schema.ts의 RecallSchema를 사용.
 */

/** MCP tool inputSchema — RecallTool constructor에 전달 */
export const RECALL_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description:
        "검색할 핵심 낱말. 이슈 번호, 기능 이름, 파일을 앞에 두고 조사와 어미는 뺀다 (e.g. \"JWT 만료 처리\"). core/vault 외에는 필수"
    },
    type: {
      type: 'string',
      enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'],
      description: '단일 타입. memory_types 가 없으면 필수'
    },
    key: {
      type: 'string'
    },
    agent_id: {
      type: 'string'
    },
    memory_types: {
      type: 'array',
      items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'] },
      description: '복수 타입 필터. type 과 같이 주면 type 우선, core/vault 는 제거된다'
    },
    tags: {
      type: 'array',
      items: { type: 'string' }
    },
    privacy_scope: {
      type: 'array',
      items: { type: 'string', enum: ['private', 'team', 'public'] }
    },
    time_from: {
      type: 'string',
      description: '시작 시각 (ISO 8601)'
    },
    time_to: {
      type: 'string',
      description: '종료 시각 (ISO 8601)'
    },
    pinned: {
      type: 'boolean'
    },
    importance_min: {
      type: 'number',
      minimum: 0,
      maximum: 1
    },
    importance_max: {
      type: 'number',
      minimum: 0,
      maximum: 1
    },
    has_reflection_notes: {
      type: 'boolean',
      description: 'reflection_notes 유무로 필터'
    },
    workflow_name: {
      type: 'string'
    },
    skill_name: {
      type: 'string'
    },
    match_trigger_conditions: {
      type: 'boolean',
      default: false
    },
    return_format: {
      type: 'string',
      enum: ['full', 'steps_only'],
      default: 'full',
      description: 'full 은 모든 필드, steps_only 는 steps 만'
    },
    limit: {
      type: 'number',
      minimum: 1,
      maximum: 100,
      default: 10,
      description: '최대 결과 수'
    },
    vector_weight: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 0.6
    },
    text_weight: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 0.4
    },
    enable_hybrid: {
      type: 'boolean',
      default: true
    },
    include_metadata: {
      type: 'boolean',
      default: true,
      description: '메타데이터 포함. false 면 score_breakdown 도 생략'
    },
    include_score_breakdown: {
      type: 'boolean',
      default: false,
      description: '각 결과에 score_breakdown 포함. include_metadata=false 면 무시'
    },
    provider_filter: {
      type: 'array',
      items: { type: 'string', enum: ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'] }
    },
    auto_set_anchor: {
      type: 'boolean',
      default: true,
      description: '첫 결과를 슬롯 A 앵커로 자동 설정 (MEMENTO_AUTO_SET_ANCHOR_DEFAULT=false 로 끔)'
    },
    include_neighbors: {
      type: 'boolean',
      default: false
    },
    neighbors_limit: {
      type: 'number',
      minimum: 1,
      maximum: 10,
      default: 3
    },
    neighbors_per_item: {
      type: 'number',
      minimum: 1,
      maximum: 50,
      default: 5
    },
    neighbors_similarity_threshold: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 0.8
    },
    version_filter: {
      type: 'string',
      enum: ['latest_only', 'all_versions', 'specific_version'],
      description: 'procedural 버전 필터. latest_only 는 시리즈당 최신, specific_version 은 version_series_id+version_number'
    },
    version_series_id: {
      type: 'string'
    },
    version_number: {
      type: 'number',
      minimum: 1
    },
    include_superseded: {
      type: 'boolean'
    },
    include_version_chain: {
      type: 'boolean'
    },
    include_diff_with: {
      type: 'string',
      description: "'previous' 는 직전 버전, 메모리 id 는 그 기억과의 diff"
    },
    owner_id: {
      type: 'string'
    },
    process_id: {
      type: 'string'
    },
    session_id: {
      type: 'string'
    },
    project_id: {
      type: 'string'
    }
  },
  // query 등 나머지 조건부 필수는 런타임 검증 (RecallSchema.refine()에서 처리).
  required: [],
  // type 은 memory_types 로 대체 가능해서 required 하나로는 표현할 수 없다.
  // 런타임이 실제로 강제하는 'type 또는 memory_types' 를 anyOf 로 광고한다 (#853).
  anyOf: [{ required: ['type'] }, { required: ['memory_types'] }],
};
