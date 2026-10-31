/**
 * One-shot generator for tests/fixtures/search-quality/relation-ko-panel-v1/
 * Synthetic only. Run: npx tsx scripts/generate-relation-ko-panel-v1.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blindPacketSha256FromParts } from './relation-ko-panel-blind-packet.js';

const root = process.cwd();
const outDir = join(root, 'tests/fixtures/search-quality/relation-ko-panel-v1');

const DEFAULT_OWNER = 'owner_rkpanel_default';
const FOREIGN_OWNER = 'owner_rkpanel_foreign';
const DEFAULT_PROJECT = 'project_rkpanel_synth';

type Mem = {
  benchmark_id: string;
  source_memory_id: string;
  type: 'semantic' | 'episodic' | 'procedural';
  created_at: string;
  tags: string[];
  content: string;
  owner_id: string;
  project_id: string;
  status?: 'active' | 'deleted' | 'superseded';
  superseded_by?: string;
};

type Rel = {
  source: string;
  target: string;
  relation_type: string;
  confidence: number;
  note?: string;
};

type QueryType = 'single_fact' | 'multi_hop' | 'irrelevant_trap';

type QueryRow = {
  query_id: string;
  query: string;
  language: 'ko';
  category: QueryType;
  split: 'dev' | 'held_out';
  cluster_id: string;
  scope_owner_id: string;
  scope_project_id: string;
};

type KeyRow = {
  query_id: string;
  query_type: QueryType;
  relevant_memory_ids: string[];
  forbidden_memory_ids: string[];
  min_hops?: number;
  rationale_impl: string;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Operational relation-type mix (nightly backup counts), scaled to `total`. */
function allocateRelationTypes(total: number): string[] {
  const weights: [string, number][] = [
    ['FOLLOWS', 11501],
    ['REFERENCES', 6580],
    ['supported_by', 5933],
    ['extracted_from', 5933],
    ['BELONGS_TO', 3516],
    ['CONTRASTS_WITH', 1051],
    ['DEPENDS_ON', 215],
    ['CAUSES', 15],
  ];
  const sum = weights.reduce((a, [, w]) => a + w, 0);
  const types: string[] = [];
  let assigned = 0;
  for (let i = 0; i < weights.length; i++) {
    const [name, w] = weights[i]!;
    const n = i === weights.length - 1 ? total - assigned : Math.round((total * w) / sum);
    assigned += n;
    for (let k = 0; k < n; k++) types.push(name);
  }
  while (types.length < total) types.push('FOLLOWS');
  while (types.length > total) types.pop();
  let seed = 1555;
  for (let i = types.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [types[i], types[j]] = [types[j]!, types[i]!];
  }
  return types;
}

const clusterNames = [
  '별빛 도서관', '솔내 연구실', '푸른 항구', '무지개 공방', '은하 수목원',
  '달빛 어학원', '새벽 시장', '고요 정원', '바람 천문대', '한울 제빵소',
  '서리 마을', '노을 갤러리', '이슬 농장', '산들 카페', '해온 항만',
  '자람 학당', '미르 공연장', '초록 언덕', '하늘 도장', '빛고을 센터',
  '들판 우체국', '물결 수영장', '고개 전망대', '나무 서점', '새싹 병원',
] as const;

function buildClusters(): {
  memories: Mem[];
  relations: Rel[];
  queries: QueryRow[];
  keys: KeyRow[];
} {
  const memories: Mem[] = [];
  const relations: Rel[] = [];
  const queries: QueryRow[] = [];
  const keys: KeyRow[] = [];
  const relTypePool = allocateRelationTypes(320);
  let relIdx = 0;
  const nextRelType = () => relTypePool[relIdx++ % relTypePool.length]!;

  const pushMem = (m: Mem) => {
    memories.push(m);
    return m.benchmark_id;
  };

  for (let c = 0; c < 25; c++) {
    const cid = `cl_${String(c + 1).padStart(2, '0')}`;
    const place = clusterNames[c]!;
    const base = `2026-09-${String((c % 28) + 1).padStart(2, '0')}T10:00:00Z`;
    const zoneN = c + 3;
    const caseRef = `RK-${String(c + 1).padStart(2, '0')}-Z${zoneN}`;

    const hopObs = pushMem({
      benchmark_id: `${cid}_hop_obs`,
      source_memory_id: `${cid}_src_hop_obs`,
      type: 'episodic',
      created_at: base,
      tags: ['synthetic', cid],
      content: `${place}에서 ${zoneN}번째 구역 안내판 글자가 깨졌다는 민원이 들어왔다. 사례번호 ${caseRef}로 접수했다. 아직 원인 조사 전이다.`,
      owner_id: DEFAULT_OWNER,
      project_id: DEFAULT_PROJECT,
    });
    const hopTry = pushMem({
      benchmark_id: `${cid}_hop_try`,
      source_memory_id: `${cid}_src_hop_try`,
      type: 'episodic',
      created_at: base.replace('10:', '14:'),
      tags: ['synthetic', cid],
      content: `${place} 안내판 복구 시도(사례 ${caseRef}). 임시 스티커를 붙였으나 퇴색이 빨라 후속 승인안 작성이 필요하다.`,
      owner_id: DEFAULT_OWNER,
      project_id: DEFAULT_PROJECT,
    });
    const hopAns = pushMem({
      benchmark_id: `${cid}_hop_ans`,
      source_memory_id: `${cid}_src_hop_ans`,
      type: 'semantic',
      created_at: base.replace('10:', '18:'),
      tags: ['synthetic', cid, 'decision'],
      content: `${caseRef} 승인 결정: 상등급 UV계열 잉크로 전면 도색, 7일 주기 현장 점검. 임시 부착식은 금지한다.`,
      owner_id: DEFAULT_OWNER,
      project_id: DEFAULT_PROJECT,
    });

    relations.push(
      { source: hopObs, target: hopTry, relation_type: nextRelType(), confidence: 0.85, note: `${cid} chain 1` },
      { source: hopTry, target: hopAns, relation_type: nextRelType(), confidence: 0.9, note: `${cid} chain 2` },
    );

    const directAns = pushMem({
      benchmark_id: `${cid}_direct`,
      source_memory_id: `${cid}_src_direct`,
      type: 'semantic',
      created_at: base,
      tags: ['synthetic', cid],
      content: `${place}의 금요일 정기 휴무는 오후 2시부터다. 토요일은 정상 개방한다.`,
      owner_id: DEFAULT_OWNER,
      project_id: DEFAULT_PROJECT,
    });

    const trapHub = pushMem({
      benchmark_id: `${cid}_hub`,
      source_memory_id: `${cid}_src_hub`,
      type: 'semantic',
      created_at: base,
      tags: ['synthetic', cid, 'hub'],
      content: `${place} 운영 색인 문서. 모든 구역 기록이 이 문서를 참조한다. 휴무 시간 답은 여기 없다.`,
      owner_id: DEFAULT_OWNER,
      project_id: DEFAULT_PROJECT,
    });
    for (const n of [hopObs, hopTry, hopAns, directAns]) {
      relations.push({
        source: trapHub,
        target: n,
        relation_type: nextRelType(),
        confidence: 0.45,
        note: `${cid} hub edge`,
      });
    }

    const trapWrong = pushMem({
      benchmark_id: `${cid}_trap_wrong`,
      source_memory_id: `${cid}_src_trap_wrong`,
      type: 'semantic',
      created_at: base,
      tags: ['synthetic', cid, 'trap'],
      content: `${place} 금요일 휴무는 오전 10시부터라는 옛 안내 초안이다. 폐기 예정이며 현재 안내와 다르다.`,
      owner_id: DEFAULT_OWNER,
      project_id: DEFAULT_PROJECT,
    });
    relations.push({
      source: trapHub,
      target: trapWrong,
      relation_type: nextRelType(),
      confidence: 0.7,
      note: `${cid} stale trap path`,
    });

    const isoCorrect = pushMem({
      benchmark_id: `${cid}_iso_ok`,
      source_memory_id: `${cid}_src_iso_ok`,
      type: 'episodic',
      created_at: base,
      tags: ['synthetic', cid],
      content: `${place} 겨울철 난방 가동 시작일은 11월 15일이다. 온도 목표는 20도다.`,
      owner_id: DEFAULT_OWNER,
      project_id: DEFAULT_PROJECT,
    });

    const qSingle: QueryRow = {
      query_id: `${cid}_q_single`,
      query: `${place} 금요일 정기 휴무는 몇 시부터인가?`,
      language: 'ko',
      category: 'single_fact',
      split: 'held_out',
      cluster_id: cid,
      scope_owner_id: DEFAULT_OWNER,
      scope_project_id: DEFAULT_PROJECT,
    };
    const qMulti: QueryRow = {
      query_id: `${cid}_q_multi`,
      query: `${place} ${zoneN}번째 구역 안내판 글자 깨짐 민원 이후 확정된 최종 규격은?`,
      language: 'ko',
      category: 'multi_hop',
      split: 'held_out',
      cluster_id: cid,
      scope_owner_id: DEFAULT_OWNER,
      scope_project_id: DEFAULT_PROJECT,
    };
    const qTrap: QueryRow = {
      query_id: `${cid}_q_trap`,
      query: `${place} 겨울철 난방 가동 시작일은?`,
      language: 'ko',
      category: 'irrelevant_trap',
      split: 'held_out',
      cluster_id: cid,
      scope_owner_id: DEFAULT_OWNER,
      scope_project_id: DEFAULT_PROJECT,
    };

    queries.push(qSingle, qMulti, qTrap);
    keys.push(
      {
        query_id: qSingle.query_id,
        query_type: 'single_fact',
        relevant_memory_ids: [directAns],
        forbidden_memory_ids: [trapWrong],
        rationale_impl: '직접 기억에 휴무 시각이 있다. 관계 없이도 검색 가능해야 한다.',
      },
      {
        query_id: qMulti.query_id,
        query_type: 'multi_hop',
        relevant_memory_ids: [hopAns],
        forbidden_memory_ids: [hopObs, trapWrong],
        min_hops: 2,
        rationale_impl: '질의·장소명·안내판 어휘는 hop_obs/hop_try에만 있고 hop_ans는 사례번호만 공유한다. 관계 없이 본문 검색만으로 hop_ans에 도달하면 안 된다.',
      },
      {
        query_id: qTrap.query_id,
        query_type: 'irrelevant_trap',
        relevant_memory_ids: [isoCorrect],
        forbidden_memory_ids: [trapWrong, trapHub],
        rationale_impl: '허브·폐기 초안과 연결되지만 정답은 고립 iso_ok다. 확장이 허브를 끌면 실패.',
      },
    );
  }

  // Scope / lifecycle traps (shared)
  pushMem({
    benchmark_id: 'rk_trap_own_foreign',
    source_memory_id: 'rk_src_trap_own_foreign',
    type: 'semantic',
    created_at: '2026-08-01T09:00:00Z',
    tags: ['synthetic', 'trap', 'owner'],
    content: '외부 owner 전용: 별빛 도서관 금요일 휴무는 오후 4시부터다. 기본 scope와 다르다.',
    owner_id: FOREIGN_OWNER,
    project_id: DEFAULT_PROJECT,
  });
  pushMem({
    benchmark_id: 'rk_trap_deleted',
    source_memory_id: 'rk_src_trap_deleted',
    type: 'semantic',
    created_at: '2026-08-02T09:00:00Z',
    tags: ['synthetic', 'trap', 'deleted'],
    content: '삭제된 기록: 솔내 연구실 금요일 휴무는 오후 1시부터였다.',
    owner_id: DEFAULT_OWNER,
    project_id: DEFAULT_PROJECT,
    status: 'deleted',
  });
  const replaced = pushMem({
    benchmark_id: 'rk_trap_replaced_old',
    source_memory_id: 'rk_src_trap_replaced_old',
    type: 'semantic',
    created_at: '2026-08-03T09:00:00Z',
    tags: ['synthetic', 'trap', 'superseded'],
    content: '구판: 푸른 항구 겨울 난방 시작일은 11월 1일이었다.',
    owner_id: DEFAULT_OWNER,
    project_id: DEFAULT_PROJECT,
    status: 'superseded',
    superseded_by: 'cl_03_iso_ok',
  });
  relations.push({
    source: 'cl_01_hub',
    target: 'rk_trap_own_foreign',
    relation_type: nextRelType(),
    confidence: 0.5,
    note: 'cross-owner trap edge',
  });
  relations.push({
    source: 'cl_02_hub',
    target: 'rk_trap_deleted',
    relation_type: nextRelType(),
    confidence: 0.6,
    note: 'deleted trap edge',
  });
  relations.push({
    source: 'cl_03_hub',
    target: replaced,
    relation_type: nextRelType(),
    confidence: 0.6,
    note: 'superseded trap edge',
  });

  for (let c = 0; c < 25; c++) {
    const cid = `cl_${String(c + 1).padStart(2, '0')}`;
    relations.push({
      source: `${cid}_iso_ok`,
      target: `${cid}_direct`,
      relation_type: nextRelType(),
      confidence: 0.4,
      note: `${cid} iso link`,
    });
  }

  relations.push({
    source: 'rk_trap_deleted',
    target: 'rk_trap_replaced_old',
    relation_type: 'DEPENDS_ON',
    confidence: 0.75,
    note: 'lifecycle trap depends',
  });
  relations.push({
    source: 'rk_trap_own_foreign',
    target: 'rk_trap_deleted',
    relation_type: 'CAUSES',
    confidence: 0.35,
    note: 'rare type sample',
  });

  const cl01Single = keys.find(k => k.query_id === 'cl_01_q_single');
  if (cl01Single) {
    cl01Single.forbidden_memory_ids.push('rk_trap_own_foreign');
    cl01Single.rationale_impl += ' foreign owner 정점은 scope 밖.';
  }

  // Dev split: first 8 queries per category (25 dev total = 8+8+9)
  const byCat: Record<QueryType, QueryRow[]> = {
    single_fact: [],
    multi_hop: [],
    irrelevant_trap: [],
  };
  for (const q of queries) byCat[q.category].push(q);
  for (const cat of ['single_fact', 'multi_hop', 'irrelevant_trap'] as QueryType[]) {
    const take = cat === 'irrelevant_trap' ? 9 : 8;
    for (let i = 0; i < take && i < byCat[cat].length; i++) {
      byCat[cat][i]!.split = 'dev';
    }
  }

  return { memories, relations, queries, keys };
}

function main() {
  const { memories, relations, queries, keys } = buildClusters();
  mkdirSync(outDir, { recursive: true });

  const corpusLines = memories.map(m => JSON.stringify(m));
  const relLines = relations.map(r => JSON.stringify(r));
  writeFileSync(join(outDir, 'corpus.jsonl'), `${corpusLines.join('\n')}\n`, 'utf8');
  writeFileSync(join(outDir, 'relations.jsonl'), `${relLines.join('\n')}\n`, 'utf8');
  writeFileSync(join(outDir, 'queries.json'), `${JSON.stringify(queries, null, 2)}\n`, 'utf8');

  const split = {
    version: 'relation-ko-panel-v1',
    policy: '판정 전 봉인. BFS 하이퍼파라미터 튜닝은 dev 쿼리만 사용. held_out 은 agent_panel gold 확정 후 측정.',
    ratio: 'dev:held_out = 1:2',
    dev_query_ids: queries.filter(q => q.split === 'dev').map(q => q.query_id),
    held_out_query_ids: queries.filter(q => q.split === 'held_out').map(q => q.query_id),
    development_fixtures: [
      {
        path: 'tests/fixtures/search-quality/relation-poc/README.md',
        note: 'PoC 대조. 원문 복제 없음.',
      },
      {
        path: 'tests/fixtures/search-quality/adoption-ko-panel-v1/corpus.jsonl',
        note: '채택 패널과 주제 분리. 바이트 중복 검사는 CI spec.',
      },
    ],
    sealed_at: null as string | null,
  };
  const splitBody = `${JSON.stringify(split, null, 2)}\n`;
  writeFileSync(join(outDir, 'split.json'), splitBody, 'utf8');
  const splitSha = sha256(splitBody);

  const generatorKey = {
    version: 'relation-ko-panel-v1',
    label: 'implementer_intent_not_gold',
    warning: '판정자 브리프·패킷에 포함하지 말 것. 감사·합의 후에만 열람.',
    operational_relation_mix_reference: {
      FOLLOWS: 11501,
      REFERENCES: 6580,
      supported_by: 5933,
      extracted_from: 5933,
      BELONGS_TO: 3516,
      CONTRASTS_WITH: 1051,
      DEPENDS_ON: 215,
      CAUSES: 15,
      source: 'nightly backup aggregate counts only, no text exported',
    },
    fixture_relation_type_counts: relations.reduce<Record<string, number>>((acc, r) => {
      acc[r.relation_type] = (acc[r.relation_type] ?? 0) + 1;
      return acc;
    }, {}),
    queries: keys,
  };
  const generatorKeyBody = `${JSON.stringify(generatorKey, null, 2)}\n`;
  writeFileSync(join(outDir, 'generator-key.json'), generatorKeyBody, 'utf8');
  const generatorKeySha = sha256(generatorKeyBody);

  const blindPacketSha = blindPacketSha256FromParts(
    `${corpusLines.join('\n')}\n`,
    relations,
    queries,
  );

  const fixtureSeals = {
    version: 'relation-ko-panel-v1',
    blind_packet_sha256: blindPacketSha,
    split_json_sha256: splitSha,
    generator_key_sha256: generatorKeySha,
    corpus_jsonl_sha256: sha256(`${corpusLines.join('\n')}\n`),
    relations_jsonl_sha256: sha256(`${relLines.join('\n')}\n`),
    queries_json_sha256: sha256(`${JSON.stringify(queries, null, 2)}\n`),
    first_judgment_discarded: {
      reason: 'multi_hop 25건이 장소명·최종 규격 어휘가 hop_ans 본문에 남아 관계 없이 본문 검색만으로 정답 도달 가능(2~3 hop 필수 계약 위반). agent_panel 75/75 일치본(커밋 8c846644) 폐기.',
      prior_blind_packet_sha256: 'cf614cce0a837d93aa5061566115f101cd3eeb615143d9c04387c289733a508d',
    },
  };
  writeFileSync(join(outDir, 'fixture-seals.json'), `${JSON.stringify(fixtureSeals, null, 2)}\n`, 'utf8');

  const typeCounts = queries.reduce<Record<string, number>>((acc, q) => {
    acc[q.category] = (acc[q.category] ?? 0) + 1;
    return acc;
  }, {});

  const protocol = `# relation-ko-panel-v1 판정 전 계약 (#1555 1단계)

상태: **후보 ${queries.length}건(질의), 정답 0건(agent_panel 미실행)**. 합성만 사용. 운영 기억 원문·private 데이터 없음.

## 출처

운영 관계 **유형 비율·연결 깊이 모양**만 참고했다. nightly 백업에서 relation_type 집계 숫자만 읽었고 content/summary 등 텍스트 컬럼은 SELECT 하지 않았다. 본 코퍼스 문장은 전부 새로 쓴 한국어 합성이다.

## 라벨링

정답은 구현자가 확정하지 않는다. 서로 다른 모델 reviewer 2명이 rubric만 보고 각 질의의 **정답 기억 id 목록**을 독립 제출한다. 불일치는 보류(ambiguous)로 남긴다. agent_panel은 사람 gold가 아니다.

## 크기

질의 유형별 ${typeCounts.single_fact ?? 0} / ${typeCounts.multi_hop ?? 0} / ${typeCounts.irrelevant_trap ?? 0} (single_fact / multi_hop / irrelevant_trap). 코퍼스 ${memories.length}건, 관계 ${relations.length}건.

## 누수 방지

\`split.json\` SHA256(판정 전 봉인): \`${splitSha}\`

dev ${split.dev_query_ids.length}건, held_out ${split.held_out_query_ids.length}건. BFS·탐색 깊이·confidence 컷 등 **하이퍼파라미터 선택은 dev만** 사용한다. held_out 은 agent_panel gold 동결 후 2단계 측정.

\`generator-key.json\` SHA256(판정 전 봉인): \`${generatorKeySha}\`

블라인드 판정 패킷 SHA256(corpus + relations(note 제외) + queries에서 category/split/cluster_id 제외): \`${blindPacketSha}\`

## 1차 agent_panel 판정본 폐기

2026-11-01 PR #1579 머슴3 리뷰: multi_hop 25건 전부 hop_ans 본문에 장소명·「최종 규격」 계열 어휘가 남아 관계 없이 본문 검색만으로 정답 도달 가능했다(2~3 hop 필수 계약 위반). 머슴4·머슴5 75/75 일치본(커밋 8c846644)과 ground-truth·panel-result·reviewer 제출은 폐기했다. 이전 블라인드 패킷 SHA256: \`cf614cce0a837d93aa5061566115f101cd3eeb615143d9c04387c289733a508d\`. 마름이 새 패킷으로 재판정 예정.

## 함정

owner scope 밖 기억(\`${FOREIGN_OWNER}\`), status deleted/superseded 정점을 그래프에 포함했다. 정답 목록에 유출 0이어야 한다(#1555 완료 기준).

## 한계

합성 그래프는 운영 34k 관계를 대표하지 못한다. 유형 비율은 근사 스케일링이다. 운영 검색 품질을 단정하지 않는다.
`;
  writeFileSync(join(outDir, 'protocol.md'), protocol, 'utf8');

  const rubric = `# relation-ko-panel-v1 블라인드 판정 rubric

판정 단위: **한 질의**와 \`scope_owner_id\` / \`scope_project_id\` 범위다. 출력은 참고 자료이며 자동 변경하지 않는다. 모든 이름·기록은 합성이다. \`generator-key.json\`·다른 reviewer·시스템 순위를 읽지 않는다.

## 입력

\`corpus.jsonl\`, \`relations.jsonl\`, \`queries.json\` 패킷만 본다. 각 기억의 \`status\`, \`owner_id\`, 본문 전체를 읽는다. deleted/superseded는 현재 답 근거에서 제외한다. scope 밖 owner는 정답 id에 넣지 않는다.

## 질의 유형

- \`single_fact\`: 관계 없이 본문만으로도 답할 수 있어야 한다. 정답 id는 **최소** 집합(동일 사실 중복 제외).
- \`multi_hop\`: 질의·장소명·핵심 명사는 시작/중간 노드에만 있어야 한다. 최종 정답 기억 본문에는 질의 고유 어휘(장소명 등)가 없어야 하며, 관계 없이 본문 검색만으로 정답 id에 도달하면 안 된다.
- \`irrelevant_trap\`: 관계로 잘못된 노드(허브·폐기 초안 등)가 연결되지만 정답은 **다른** 고립/직접 기억이다. 함정 id는 정답에 넣지 않는다.

## 제출

각 질의마다 \`relevant_memory_ids\`(정답 id 배열), \`ambiguous\`(bool), \`rationale\`, \`reviewer_id\`, \`model\`, \`judged_at\`(UTC), \`data_sha256\`(패킷 corpus+relations+queries 합)을 제출한다. agent_panel이며 사람 gold로 부르지 않는다.
`;
  writeFileSync(join(outDir, 'rubric.md'), rubric, 'utf8');

  const readme = `# relation-ko-panel-v1 (#1555 1단계 재생성)

관계 BFS 검색 효용 측정용 **합성** 한국어 패널. agent_panel gold 없음(1차 75/75 판정본 폐기, protocol 참고).

재생성(개발용):

\`\`\`bash
npx tsx scripts/generate-relation-ko-panel-v1.ts
\`\`\`

검증:

\`\`\`bash
npx vitest run tests/relation-ko-panel-fixture.spec.ts
\`\`\`
`;
  writeFileSync(join(outDir, 'README.md'), readme, 'utf8');

  process.stdout.write(
    `Wrote ${memories.length} memories, ${relations.length} relations, ${queries.length} queries to ${outDir}\n`,
  );
}

main();
