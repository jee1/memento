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
        "검색할 내용을 자연어 문장으로 입력하세요 (예: '지난번에 JWT 토큰 만료 처리한 방법이 뭐였지?', e.g. \"How did we handle JWT expiry last time?\"). 키워드 나열보다 문장 형태가 의미 기반 검색 품질을 높입니다. type이 core 또는 vault가 아닌 경우 필수이며, memory_types만 제공된 경우에도 query는 필수입니다."
    },
    type: {
      type: 'string',
      enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'],
      description: '단일 메모리 타입 지정 (선택사항). 가능하면 항상 명시하는 것을 권장합니다.'
    },
    key: {
      type: 'string',
      description: 'Core/Vault 조회 시 특정 키 지정 (선택사항)'
    },
    agent_id: {
      type: 'string',
      description: '에이전트 ID (Core/Vault 조회 시 사용, 기본값: "default")'
    },
    memory_types: {
      type: 'array',
      items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'] },
      description:
        '복수 타입 필터 (선택사항, type 파라미터와 동시 사용 시 type 우선). core/vault는 자동으로 제거됩니다. type을 생략해도 이 배열이 비어 있지 않으면 missing-type 경고가 생략될 수 있습니다.'
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: '태그 필터 (선택사항)'
    },
    privacy_scope: {
      type: 'array',
      items: { type: 'string', enum: ['private', 'team', 'public'] },
      description: '프라이버시 범위 필터 (선택사항)'
    },
    time_from: {
      type: 'string',
      description: '시작 시간 (ISO 8601 형식, 선택사항)'
    },
    time_to: {
      type: 'string',
      description: '종료 시간 (ISO 8601 형식, 선택사항)'
    },
    pinned: {
      type: 'boolean',
      description: '핀된 기억만 검색 (선택사항)'
    },
    importance_min: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: '최소 중요도 (선택사항)'
    },
    importance_max: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: '최대 중요도 (0-1, 선택사항)'
    },
    has_reflection_notes: {
      type: 'boolean',
      description: 'reflection_notes가 있는 메모리만 조회 (true: IS NOT NULL, false: IS NULL, 선택사항)'
    },
    workflow_name: {
      type: 'string',
      description: '프로세스 이름으로 필터링 (선택사항)'
    },
    skill_name: {
      type: 'string',
      description: '기술/능력 이름으로 필터링 (선택사항)'
    },
    match_trigger_conditions: {
      type: 'boolean',
      default: false,
      description: 'trigger_conditions 매칭 여부 (기본값: false)'
    },
    return_format: {
      type: 'string',
      enum: ['full', 'steps_only'],
      default: 'full',
      description: '반환 형식 선택: full (모든 필드), steps_only (steps만 반환)'
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
      default: 0.6,
      description: '벡터 검색 가중치 (선택사항)'
    },
    text_weight: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 0.4,
      description: '텍스트 검색 가중치 (선택사항)'
    },
    enable_hybrid: {
      type: 'boolean',
      default: true,
      description: '하이브리드 검색 사용 여부 (선택사항)'
    },
    include_metadata: {
      type: 'boolean',
      default: true,
      description:
        '메타데이터 포함 여부 (선택사항). false면 응답에서 메타데이터 블록을 생략하며, score_breakdown도 포함하지 않음(include_score_breakdown=true여도).'
    },
    include_score_breakdown: {
      type: 'boolean',
      default: false,
      description:
        'true일 때 각 결과에 score_breakdown 포함. include_metadata=false이면 적용되지 않음(메타·세부 점수 모두 생략). relevance.score/pct는 α·relevance(블렌딩)뿐 아니라 관계·절차·process_fit 기여를 동일 슬롯에 합산(FR-008·contracts §1).'
    },
    provider_filter: {
      type: 'array',
      items: { type: 'string', enum: ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'] },
      description: '검색할 임베딩 provider 필터 (선택사항, 미지정 시 모든 provider 검색)'
    },
    auto_set_anchor: {
      type: 'boolean',
      default: false,
      description: '가장 관련성 높은 기억(첫 번째 결과)을 슬롯 A에 자동으로 앵커로 설정 (기본값: false)'
    },
    include_neighbors: {
      type: 'boolean',
      default: false,
      description: '검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함 (기본값: false)'
    },
    neighbors_limit: {
      type: 'number',
      minimum: 1,
      maximum: 10,
      default: 3,
      description: '이웃 기억을 포함할 상위 결과의 개수 (각 결과당 이웃 개수는 neighbors_per_item으로 제어, 기본값: 3)'
    },
    neighbors_per_item: {
      type: 'number',
      minimum: 1,
      maximum: 50,
      default: 5,
      description: '각 검색 결과 항목당 조회할 이웃 기억의 최대 개수 (기본값: 5)'
    },
    neighbors_similarity_threshold: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      default: 0.8,
      description: '이웃 기억 조회 시 유사도 임계값 (이 값 이상인 기억만 반환, 기본값: 0.8)'
    },
    version_filter: {
      type: 'string',
      enum: ['latest_only', 'all_versions', 'specific_version'],
      description:
        'procedural 기억 버전 필터: latest_only(시리즈당 최신만), all_versions(전체), specific_version(version_series_id+version_number로 지정)'
    },
    version_series_id: {
      type: 'string',
      description: '버전 시리즈 ID (specific_version일 때 또는 특정 시리즈만 볼 때 사용)'
    },
    version_number: {
      type: 'number',
      minimum: 1,
      description: '특정 버전 번호 (specific_version일 때 version_series_id와 함께 사용)'
    },
    include_version_chain: {
      type: 'boolean',
      description: 'true이면 procedural 결과에 version_chain(버전 이력 배열) 포함'
    },
    include_diff_with: {
      type: 'string',
      description:
        "'previous'면 직전 버전과의 diff, 메모리 id면 해당 id와의 diff를 diff_with_previous 또는 diff_with 필드로 반환"
    },
    owner_id: {
      type: 'string',
      description: '다중 에이전트: 소유자 ID로 결과 필터 (단일 문자열 또는 문자열 배열). 미설정 시 전체 조회'
    },
    process_id: {
      type: 'string',
      description: 'Memori Attribution: 프로세스 ID로 결과 필터 (Issue #87)'
    },
    session_id: {
      type: 'string',
      description: 'Memori Attribution: 세션 ID로 결과 필터 (Issue #87)'
    },
    project_id: {
      type: 'string',
      description: 'Project-scoped Memory: 프로젝트 ID로 결과 필터 (Issue #81). 미설정 시 전체 검색'
    }
  },
  required: [] // 조건부 필수는 런타임 검증 (RecallSchema.refine()에서 처리)
} as const;
