/**
 * The usage record a Claude Code transcript carries, and the one thing that is
 * not obvious about reading it.
 *
 * Shared by the two tools that price a transcript — the per-session summary and
 * the usage report — because reading it differently in the two would mean the
 * same session cost two different amounts depending on which was asked.
 */

export interface TranscriptUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface CacheWrites {
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/**
 * Older transcripts report one cache-write total; newer ones break it into the
 * two TTLs, which are priced differently. A transcript carrying the breakdown
 * still carries the old total, so reading both would count those tokens twice —
 * and the older total is billed as 5m, which is what it was.
 */
export function cacheWritesOf(usage: TranscriptUsage): CacheWrites {
  const fiveMinute = usage.cache_creation?.ephemeral_5m_input_tokens;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens;
  const hasBreakdown = fiveMinute !== undefined || oneHour !== undefined;
  return {
    cacheWrite5m: hasBreakdown
      ? (fiveMinute ?? 0)
      : (usage.cache_creation_input_tokens ?? 0),
    cacheWrite1h: oneHour ?? 0,
  };
}
