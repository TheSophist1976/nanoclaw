import { getDb } from './connection.js';

export interface ApiUsageEntry {
  timestamp: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  estimated_cost_usd: number;
  request_path: string | null;
  status_code: number | null;
}

// Pricing per million tokens (USD) — update when pricing changes
const MODEL_PRICING: Record<string, { input: number; output: number; cache_write: number; cache_read: number }> = {
  'claude-haiku-4-5': { input: 0.8, output: 4, cache_write: 1, cache_read: 0.08 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-opus-4-7': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
};

export function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  if (!model) return 0;
  const pricing = Object.entries(MODEL_PRICING).find(([key]) => model.toLowerCase().includes(key))?.[1];
  if (!pricing) return 0;
  const M = 1_000_000;
  return (
    (inputTokens * pricing.input) / M +
    (outputTokens * pricing.output) / M +
    (cacheWriteTokens * pricing.cache_write) / M +
    (cacheReadTokens * pricing.cache_read) / M
  );
}

export function logApiUsage(entry: ApiUsageEntry): void {
  getDb()
    .prepare(
      `INSERT INTO api_usage (timestamp, model, input_tokens, output_tokens,
       cache_creation_input_tokens, cache_read_input_tokens,
       estimated_cost_usd, request_path, status_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.timestamp,
      entry.model,
      entry.input_tokens,
      entry.output_tokens,
      entry.cache_creation_input_tokens,
      entry.cache_read_input_tokens,
      entry.estimated_cost_usd,
      entry.request_path,
      entry.status_code,
    );
}

export interface UsageSummary {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_write_tokens: number;
  total_cache_read_tokens: number;
  total_estimated_cost_usd: number;
  request_count: number;
  by_model: Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    request_count: number;
  }>;
}

export function getUsageSummary(sinceIso: string): UsageSummary {
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output,
        COALESCE(SUM(cache_creation_input_tokens), 0) as total_cache_write,
        COALESCE(SUM(cache_read_input_tokens), 0) as total_cache_read,
        COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
        COUNT(*) as request_count
       FROM api_usage WHERE timestamp >= ?`,
    )
    .get(sinceIso) as {
    total_input: number;
    total_output: number;
    total_cache_write: number;
    total_cache_read: number;
    total_cost: number;
    request_count: number;
  };

  const byModel = db
    .prepare(
      `SELECT model,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) as estimated_cost_usd,
        COUNT(*) as request_count
       FROM api_usage WHERE timestamp >= ?
       GROUP BY model ORDER BY estimated_cost_usd DESC`,
    )
    .all(sinceIso) as Array<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    request_count: number;
  }>;

  return {
    total_input_tokens: totals.total_input,
    total_output_tokens: totals.total_output,
    total_cache_write_tokens: totals.total_cache_write,
    total_cache_read_tokens: totals.total_cache_read,
    total_estimated_cost_usd: totals.total_cost,
    request_count: totals.request_count,
    by_model: byModel,
  };
}
