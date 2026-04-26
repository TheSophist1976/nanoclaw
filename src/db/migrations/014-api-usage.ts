import type Database from 'better-sqlite3';

import type { Migration } from './index.js';

export const migration014ApiUsage: Migration = {
  version: 14,
  name: 'api-usage-tracking',
  up(db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        model TEXT,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_creation_input_tokens INTEGER DEFAULT 0,
        cache_read_input_tokens INTEGER DEFAULT 0,
        estimated_cost_usd REAL DEFAULT 0,
        request_path TEXT,
        status_code INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_api_usage_timestamp ON api_usage(timestamp);
    `);
  },
};
