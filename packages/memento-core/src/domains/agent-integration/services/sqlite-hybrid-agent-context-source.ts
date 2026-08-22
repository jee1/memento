import type Database from 'better-sqlite3';
import type { HybridSearchEngine } from '../../search/algorithms/hybrid-search-engine.js';
import type { MemoryType, PrivacyScope } from '../../../shared/types/memory.types.js';
import type { MemorySearchFilters } from '../../../shared/types/search.types.js';
import type {
  AgentContextCandidate,
  AgentContextRecallSource,
  AgentContextScope,
  AgentContextSourceResult,
} from './agent-context-recall-service.js';
import { clamp01 } from '../../../shared/utils/clamp.js';

export interface SqliteHybridAgentContextSourceOptions {
  db: Database.Database;
  hybridSearchEngine: HybridSearchEngine;
}

export class SqliteHybridAgentContextSource implements AgentContextRecallSource {
  readonly name = 'hybrid-search';
  private readonly db: Database.Database;
  private readonly hybridSearchEngine: HybridSearchEngine;

  constructor(options: SqliteHybridAgentContextSourceOptions) {
    this.db = options.db;
    this.hybridSearchEngine = options.hybridSearchEngine;
  }

  async recall(input: {
    query: string;
    scope: AgentContextScope;
    limit: number;
  }): Promise<AgentContextSourceResult> {
    const searches = scopeSearchFilters(input.scope).map((filters) =>
      this.hybridSearchEngine.search(this.db, {
        query: input.query,
        filters,
        limit: input.limit,
        vectorWeight: 0.7,
        textWeight: 0.3,
      }),
    );
    const results = await Promise.all(searches);
    const bestHits = new Map<string, number>();
    for (const result of results) {
      for (const item of result.items) {
        bestHits.set(item.id, Math.max(bestHits.get(item.id) ?? 0, item.finalScore));
      }
    }

    const rows = this.loadMemoryRows([...bestHits.keys()]);
    const items = rows
      .map((row): AgentContextCandidate | null => {
        const type = asMemoryType(row.type);
        const privacyScope = asPrivacyScope(row.privacy_scope);
        if (!type || !privacyScope) {
          return null;
        }
        return {
          id: row.id,
          content: row.content,
          type,
          relevance: bestHits.get(row.id) ?? 0,
          importance: row.importance,
          createdAt: row.created_at,
          provenanceConfidence: clamp01(row.confidence ?? Number.NaN, 0.5),
          privacyScope,
          ownerId: row.owner_id,
          projectId: row.project_id,
          processId: row.process_id,
          sessionId: row.session_id,
          topics: parseTags(row.tags),
        };
      })
      .filter((item): item is AgentContextCandidate => item !== null)
      .sort((a, b) => b.relevance - a.relevance || a.id.localeCompare(b.id));

    return {
      items,
      ...(results.some((result) =>
        result.fallback_used === true || result.tfidf_query_embedding_fallback === true
      )
        ? {
            degradedReason: {
              code: 'search_fallback' as const,
              message: 'hybrid search used a fallback path',
            },
          }
        : {}),
    };
  }

  private loadMemoryRows(ids: string[]): MemoryRow[] {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => '?').join(', ');
    return this.db.prepare(`
      SELECT
        id, type, content, importance, privacy_scope,
        owner_id, project_id, process_id, session_id,
        confidence, created_at, tags
      FROM memory_item
      WHERE id IN (${placeholders})
    `).all(...ids) as MemoryRow[];
  }
}

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  owner_id: string | null;
  project_id: string | null;
  process_id: string | null;
  session_id: string | null;
  confidence: number | null;
  created_at: string;
  tags: string | null;
}

function scopeSearchFilters(scope: AgentContextScope): MemorySearchFilters[] {
  const filters: MemorySearchFilters[] = [];
  if (scope.projectId) {
    filters.push(
      {
        privacy_scope: ['private'],
        owner_id: scope.ownerId,
        project_id: scope.projectId,
      },
      {
        privacy_scope: ['team'],
        project_id: scope.projectId,
      },
      {
        privacy_scope: ['public'],
        project_id: scope.projectId,
      },
    );
  }
  filters.push(
    { privacy_scope: ['private'], owner_id: scope.ownerId },
    { privacy_scope: ['public'], owner_id: scope.ownerId },
  );
  return filters;
}

function asMemoryType(value: string): MemoryType | null {
  return value === 'working'
    || value === 'episodic'
    || value === 'semantic'
    || value === 'procedural'
    ? value
    : null;
}

function asPrivacyScope(value: string): PrivacyScope | null {
  return value === 'private' || value === 'team' || value === 'public'
    ? value
    : null;
}

function parseTags(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
