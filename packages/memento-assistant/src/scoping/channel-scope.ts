export interface ScopeOpts {
  ownerId?: string;
  channel?: string;
  userTags?: string[];
  crossChannelRecall?: 'on' | 'off' | 'sameContext';
}

export interface Logger {
  warn(msg: string): void;
}

const noopLogger: Logger = { warn() {} };

export function scopeRecallFilters(
  scope: ScopeOpts,
  filters: { tags?: string[]; ownerId?: string; type?: string[] },
  logger: Logger = noopLogger,
): { tags?: string[]; ownerId?: string; type?: string[] } {
  const ownerId = filters.ownerId ?? scope.ownerId;
  let mode = scope.crossChannelRecall ?? 'on';
  if (mode === 'sameContext') {
    logger.warn("crossChannelRecall='sameContext' is reserved for v0.2; falling back to 'on' for v0.1");
    mode = 'on';
  }
  if (mode === 'on') {
    return { ...filters, ownerId };
  }
  // mode === 'off'
  const channelTag = scope.channel ? [`channel:${scope.channel}`] : [];
  const tags = Array.from(new Set([...(filters.tags ?? []), ...channelTag]));
  return { ...filters, tags, ownerId };
}

export function scopeRememberTags(
  scope: ScopeOpts,
  ctx: { conversationId?: string },
): string[] {
  const out: string[] = [...(scope.userTags ?? [])];
  if (scope.channel) out.push(`channel:${scope.channel}`);
  if (ctx.conversationId) out.push(`conv:${ctx.conversationId}`);
  return Array.from(new Set(out));
}
