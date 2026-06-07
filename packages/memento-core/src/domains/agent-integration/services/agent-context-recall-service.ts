import type { MemoryType, PrivacyScope } from '../../../shared/types/index.js';

export type AgentContextScopeLevel = 'session' | 'process' | 'project' | 'owner';
export type AgentContextStatus = 'ok' | 'empty' | 'degraded';

export interface AgentContextScope {
  ownerId: string;
  projectId?: string;
  processId?: string;
  sessionId?: string;
}

export interface AgentContextCandidate {
  id: string;
  content: string;
  type: MemoryType;
  relevance: number;
  importance: number;
  createdAt: string;
  provenanceConfidence: number;
  privacyScope: PrivacyScope;
  ownerId: string | null;
  projectId: string | null;
  processId: string | null;
  sessionId: string | null;
  topics?: string[];
}

export interface AgentContextRecallSource {
  name: string;
  recall(input: {
    query: string;
    scope: AgentContextScope;
    limit: number;
  }): Promise<AgentContextSourceResult>;
}

export interface AgentContextSourceResult {
  items: AgentContextCandidate[];
  degradedReason?: {
    code: 'search_fallback';
    message: string;
  };
}

export interface AgentTokenEstimator {
  estimate(text: string): number;
}

export interface AgentContextRecallRequest {
  query: string;
  scope: AgentContextScope;
  tokenBudget: number;
  maxItems?: number;
  now?: string;
}

export interface SelectedAgentContextItem extends AgentContextCandidate {
  score: number;
  scopeLevel: AgentContextScopeLevel;
  tokenEstimate: number;
  selectionReason: 'selected_by_score' | 'selected_for_diversity';
}

export interface ExcludedAgentContextItem {
  id: string;
  reason:
    | 'privacy_scope_mismatch'
    | 'scope_mismatch'
    | 'duplicate'
    | 'diversity_deferred'
    | 'token_budget_exceeded'
    | 'max_items_reached';
  score: number;
  tokenEstimate: number;
  duplicateOf?: string;
}

export interface AgentContextRecallResult {
  status: AgentContextStatus;
  query: string;
  contextText: string;
  selected: SelectedAgentContextItem[];
  excluded: ExcludedAgentContextItem[];
  tokenUsage: {
    budget: number;
    used: number;
    remaining: number;
  };
  degradedReasons: Array<{
    source: string;
    code: 'source_failed' | 'search_fallback';
    message: string;
  }>;
}

export interface AgentContextRecallServiceOptions {
  sources: AgentContextRecallSource[];
  tokenEstimator?: AgentTokenEstimator;
  estimationErrorRatio?: number;
  perItemOverheadTokens?: number;
}

export class AgentContextRecallService {
  private readonly sources: AgentContextRecallSource[];
  private readonly tokenEstimator: AgentTokenEstimator;
  private readonly estimationErrorRatio: number;
  private readonly perItemOverheadTokens: number;

  constructor(options: AgentContextRecallServiceOptions) {
    this.sources = [...options.sources];
    this.tokenEstimator = options.tokenEstimator ?? {
      estimate: (text) => Math.ceil(text.length / 3),
    };
    this.estimationErrorRatio = nonNegativeNumber(options.estimationErrorRatio ?? 0.25);
    this.perItemOverheadTokens = nonNegativeInteger(options.perItemOverheadTokens ?? 8);
  }

  async buildContext(request: AgentContextRecallRequest): Promise<AgentContextRecallResult> {
    const budget = nonNegativeInteger(request.tokenBudget);
    const maxItems = nonNegativeInteger(request.maxItems ?? 8);
    const sourceResults = await Promise.allSettled(
      this.sources.map((item) =>
        item.recall({
          query: request.query,
          scope: request.scope,
          limit: Math.max(maxItems * 4, 20),
        }),
      ),
    );

    const degradedReasons: AgentContextRecallResult['degradedReasons'] = [];
    const candidates: AgentContextCandidate[] = [];
    sourceResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        candidates.push(...result.value.items);
        if (result.value.degradedReason) {
          degradedReasons.push({
            source: this.sources[index]?.name ?? `source-${index}`,
            ...result.value.degradedReason,
          });
        }
        return;
      }
      degradedReasons.push({
        source: this.sources[index]?.name ?? `source-${index}`,
        code: 'source_failed',
        message: errorMessage(result.reason),
      });
    });

    const excluded: ExcludedAgentContextItem[] = [];
    const eligible = candidates.flatMap((item) => {
      const privacyReason = getPrivacyExclusionReason(item, request.scope);
      if (privacyReason) {
        excluded.push({
          id: item.id,
          reason: privacyReason,
          score: 0,
          tokenEstimate: this.estimateConservativeTokens(item.content),
        });
        return [];
      }

      const scopeLevel = classifyScope(item, request.scope);
      if (!scopeLevel) {
        excluded.push({
          id: item.id,
          reason: 'scope_mismatch',
          score: 0,
          tokenEstimate: this.estimateConservativeTokens(item.content),
        });
        return [];
      }

      return [{
        item,
        scopeLevel,
        score: scoreCandidate(item, scopeLevel, request.now ?? new Date().toISOString()),
      }];
    });

    eligible.sort(compareRankedCandidates);
    const unique = deduplicateCandidates(
      eligible,
      excluded,
      (content) => this.estimateConservativeTokens(content),
    );
    const ordered = diversityOrder(unique);
    const selected: SelectedAgentContextItem[] = [];
    let usedTokens = 0;

    for (const ranked of ordered) {
      const tokenEstimate = this.estimateConservativeTokens(ranked.item.content);
      if (selected.length >= maxItems) {
        excluded.push({
          id: ranked.item.id,
          reason: 'max_items_reached',
          score: ranked.score,
          tokenEstimate,
        });
        continue;
      }
      if (usedTokens + tokenEstimate > budget) {
        excluded.push({
          id: ranked.item.id,
          reason: 'token_budget_exceeded',
          score: ranked.score,
          tokenEstimate,
        });
        continue;
      }

      const selectedForDiversity = selected.length > 0 && addsDiversity(ranked.item, selected);
      selected.push({
        ...ranked.item,
        score: ranked.score,
        scopeLevel: ranked.scopeLevel,
        tokenEstimate,
        selectionReason: selectedForDiversity
          ? 'selected_for_diversity'
          : 'selected_by_score',
      });
      usedTokens += tokenEstimate;
    }

    return {
      status: selected.length === 0
        ? degradedReasons.length > 0
          ? 'degraded'
          : 'empty'
        : degradedReasons.length > 0
          ? 'degraded'
          : 'ok',
      query: request.query,
      contextText: selected.map((item) => item.content).join('\n\n'),
      selected,
      excluded,
      tokenUsage: {
        budget,
        used: usedTokens,
        remaining: budget - usedTokens,
      },
      degradedReasons,
    };
  }

  private estimateConservativeTokens(text: string): number {
    const estimate = nonNegativeNumber(this.tokenEstimator.estimate(text));
    return Math.ceil(estimate * (1 + this.estimationErrorRatio))
      + this.perItemOverheadTokens;
  }
}

interface RankedCandidate {
  item: AgentContextCandidate;
  scopeLevel: AgentContextScopeLevel;
  score: number;
}

const SCOPE_BONUS: Record<AgentContextScopeLevel, number> = {
  session: 0.08,
  process: 0.06,
  project: 0.04,
  owner: 0.02,
};
const SCOPE_ORDER: AgentContextScopeLevel[] = ['session', 'process', 'project', 'owner'];

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function nonNegativeNumber(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getPrivacyExclusionReason(
  candidate: AgentContextCandidate,
  scope: AgentContextScope,
): 'privacy_scope_mismatch' | null {
  if (candidate.privacyScope === 'private') {
    if (candidate.ownerId !== scope.ownerId) {
      return 'privacy_scope_mismatch';
    }
    if (candidate.projectId !== null && candidate.projectId !== scope.projectId) {
      return 'privacy_scope_mismatch';
    }
    return null;
  }

  if (candidate.privacyScope === 'team') {
    if (!scope.projectId || candidate.projectId !== scope.projectId) {
      return 'privacy_scope_mismatch';
    }
  }
  return null;
}

function classifyScope(
  candidate: AgentContextCandidate,
  scope: AgentContextScope,
): AgentContextScopeLevel | null {
  if (scope.sessionId && candidate.sessionId === scope.sessionId) {
    return 'session';
  }
  if (scope.processId && candidate.processId === scope.processId) {
    return 'process';
  }
  if (scope.projectId && candidate.projectId === scope.projectId) {
    return 'project';
  }
  if (candidate.ownerId === scope.ownerId && candidate.projectId === null) {
    return 'owner';
  }
  return null;
}

function scoreCandidate(
  candidate: AgentContextCandidate,
  scopeLevel: AgentContextScopeLevel,
  now: string,
): number {
  const ageMs = Math.max(0, Date.parse(now) - Date.parse(candidate.createdAt));
  const recency = Number.isFinite(ageMs)
    ? Math.max(0, 1 - ageMs / (90 * 24 * 60 * 60 * 1000))
    : 0;
  const score =
    clamp01(candidate.relevance) * 0.45
    + clamp01(candidate.importance) * 0.2
    + recency * 0.15
    + clamp01(candidate.provenanceConfidence) * 0.2
    + SCOPE_BONUS[scopeLevel];
  return Number(score.toFixed(8));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function compareRankedCandidates(a: RankedCandidate, b: RankedCandidate): number {
  return SCOPE_ORDER.indexOf(a.scopeLevel) - SCOPE_ORDER.indexOf(b.scopeLevel)
    || b.score - a.score
    || a.item.id.localeCompare(b.item.id);
}

function deduplicateCandidates(
  candidates: RankedCandidate[],
  excluded: ExcludedAgentContextItem[],
  estimateTokens: (content: string) => number,
): RankedCandidate[] {
  const kept: RankedCandidate[] = [];
  for (const candidate of candidates) {
    const duplicate = kept.find((existing) =>
      existing.item.id === candidate.item.id
      || contentSimilarity(existing.item.content, candidate.item.content) >= 0.85
    );
    if (duplicate) {
      excluded.push({
        id: candidate.item.id,
        reason: 'duplicate',
        score: candidate.score,
        tokenEstimate: estimateTokens(candidate.item.content),
        duplicateOf: duplicate.item.id,
      });
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}

function contentSimilarity(a: string, b: string): number {
  const left = normalizedTerms(a);
  const right = normalizedTerms(b);
  if (left.size === 0 && right.size === 0) {
    return 1;
  }
  const intersection = [...left].filter((term) => right.has(term)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function normalizedTerms(content: string): Set<string> {
  return new Set(
    content
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

function diversityOrder(candidates: RankedCandidate[]): RankedCandidate[] {
  const ordered: RankedCandidate[] = [];
  for (const scopeLevel of SCOPE_ORDER) {
    ordered.push(...diversityOrderWithinScope(
      candidates.filter((candidate) => candidate.scopeLevel === scopeLevel),
    ));
  }
  return ordered;
}

function diversityOrderWithinScope(candidates: RankedCandidate[]): RankedCandidate[] {
  if (candidates.length <= 1) {
    return candidates;
  }
  const remaining = [...candidates];
  const ordered: RankedCandidate[] = [remaining.shift()!];
  while (remaining.length > 0) {
    const diverseIndex = remaining.findIndex((candidate) =>
      addsDiversity(candidate.item, ordered.map((item) => item.item))
    );
    ordered.push(...remaining.splice(diverseIndex >= 0 ? diverseIndex : 0, 1));
  }
  return ordered;
}

function addsDiversity(
  candidate: AgentContextCandidate,
  selected: AgentContextCandidate[],
): boolean {
  const selectedTypes = new Set(selected.map((item) => item.type));
  const selectedTopics = new Set(selected.flatMap((item) => item.topics ?? []));
  const hasNewType = !selectedTypes.has(candidate.type);
  const topics = candidate.topics ?? [];
  const hasNewTopic = topics.length > 0 && topics.some((topic) => !selectedTopics.has(topic));
  return hasNewType && hasNewTopic;
}
