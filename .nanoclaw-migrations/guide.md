# NanoClaw Migration Guide

Generated: 2026-04-26T00:00:00Z
Base: eba94b721ab8c7476e97d6600ca7ee4c0e53249c
HEAD at generation: 319afac (v2 upgrade complete)
Upstream at upgrade: 0bc082a (upstream/main v2.0.13)

---

## Migration Plan

This is a Tier 3 complex migration. Order of operations:

1. **Add external remotes** (telegram, gmail) — needed for skill merges
2. **Re-merge upstream skill branches** (compact, channel-formatting, native-credential-proxy)
3. **Merge external remote branches** (telegram, gmail)
4. **Apply source customizations** — all changes to `src/*.ts`
5. **Apply build/config changes** — `package.json`
6. **Copy custom container skills** — entire `container/skills/` directory
7. **Copy group CLAUDE.md files** — `groups/global/CLAUDE.md` and `groups/main/CLAUDE.md`
8. **Copy scripts** — `scripts/google-oauth.mjs`, `scripts/sentinel/`
9. **Remove CI workflows** — `bump-version.yml`, `update-tokens.yml`

**Staging:** Validate `npm run build` after step 4 before proceeding. Skills in step 6 are pure copy — no code changes needed.

**Risk areas:** `src/ipc.ts` may have upstream changes that conflict with customizations. Read the upstream version carefully before applying changes.

**Note on agent-runner:** v2 ships a completely new Bun-based `container/agent-runner/`. Do not apply any v1 agent-runner customizations to it — the architecture changed entirely. The compact skill modification (see "Modifications to Applied Skills") will need to be re-evaluated against v2's compact skill branch.

---

## Applied Skills

These upstream skill branches were merged. Reapply by merging them in the upgrade worktree.

- `compact` — branch `skill/compact`
- `channel-formatting` — branch `skill/channel-formatting`
- `native-credential-proxy` — branch `skill/native-credential-proxy`

External remotes that must be added before their branches can be merged:

- `telegram` remote: `https://github.com/qwibitai/nanoclaw-telegram.git`
  - merge branch: `telegram/main`
- `gmail` remote: `https://github.com/qwibitai/nanoclaw-gmail.git`
  - merge branch: `gmail/main`

```bash
git remote add telegram https://github.com/qwibitai/nanoclaw-telegram.git
git remote add gmail https://github.com/qwibitai/nanoclaw-gmail.git
git fetch telegram
git fetch gmail
git merge upstream/skill/compact --no-edit
git merge upstream/skill/channel-formatting --no-edit
git merge upstream/skill/native-credential-proxy --no-edit
git merge telegram/main --no-edit
git merge gmail/main --no-edit
```

Custom skills (user-created, not from upstream): the entire `container/skills/` directory is custom — copy it as-is from the main tree (see "Custom Container Skills" section below).

---

## Skill Interactions

The following skills all touch `src/index.ts`:

- `skill/compact` adds slash command handling in `container/agent-runner/src/index.ts` and session command interception in `src/index.ts`
- `skill/channel-formatting` adds `parseTextStyles` call in `src/router.ts` and `formatOutbound` signature change
- `skill/native-credential-proxy` removes OneCLI agent creation from `src/index.ts` and adds credential proxy startup

After merging all skill branches, the user's customizations add more changes on top of these same files. Apply user customizations AFTER all skill merges to avoid conflicts.

---

## Modifications to Applied Skills

### compact: Enhanced slash command handling in agent-runner

**Intent:** The compact skill's slash command handling in `container/agent-runner/src/index.ts` was extended to observe the `compact_boundary` system event, track whether compaction actually completed, and emit appropriate result/error messages with session tracking.

**Files:** `container/agent-runner/src/index.ts` (the slash command section)

**v2 note:** v2 ships an entirely new Bun-based agent-runner. This customization was for the v1 Node.js runner and cannot be applied as-is. After upgrading to v2, check whether the `skill/compact` branch has been updated for v2 and re-evaluate whether this enhancement is still relevant or if the new runner handles it differently.

**How to apply (v1 only, for reference):** After merging `skill/compact`, the slash command section in `container/agent-runner/src/index.ts` between `// --- Slash command handling ---` and `// --- End slash command handling ---` should be replaced with this complete implementation:

```typescript
// --- Slash command handling ---
// Only known session slash commands are handled here. This prevents
// accidental interception of user prompts that happen to start with '/'.
const KNOWN_SESSION_COMMANDS = new Set(['/compact']);
const trimmedPrompt = prompt.trim();
const isSessionSlashCommand = KNOWN_SESSION_COMMANDS.has(trimmedPrompt);

if (isSessionSlashCommand) {
  log(`Handling session command: ${trimmedPrompt}`);
  let slashSessionId: string | undefined;
  let compactBoundarySeen = false;
  let hadError = false;
  let resultEmitted = false;

  try {
    for await (const message of query({
      prompt: trimmedPrompt,
      options: {
        model: modelOverride,
        cwd: '/workspace/group',
        resume: sessionId,
        systemPrompt: undefined,
        allowedTools: [],
        env: sdkEnv,
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
        settingSources: ['project', 'user'] as const,
        hooks: {
          PreCompact: [{ hooks: [createPreCompactHook(containerInput.assistantName)] }],
        },
      },
    })) {
      const msgType = message.type === 'system'
        ? `system/${(message as { subtype?: string }).subtype}`
        : message.type;
      log(`[slash-cmd] type=${msgType}`);

      if (message.type === 'system' && message.subtype === 'init') {
        slashSessionId = message.session_id;
        log(`Session after slash command: ${slashSessionId}`);
      }

      // Observe compact_boundary to confirm compaction completed
      if (message.type === 'system' && (message as { subtype?: string }).subtype === 'compact_boundary') {
        compactBoundarySeen = true;
        log('Compact boundary observed — compaction completed');
      }

      if (message.type === 'result') {
        const resultSubtype = (message as { subtype?: string }).subtype;
        const textResult = 'result' in message ? (message as { result?: string }).result : null;

        if (resultSubtype?.startsWith('error')) {
          hadError = true;
          writeOutput({
            status: 'error',
            result: null,
            error: textResult || 'Session command failed.',
            newSessionId: slashSessionId,
          });
        } else {
          writeOutput({
            status: 'success',
            result: textResult || 'Conversation compacted.',
            newSessionId: slashSessionId,
          });
        }
        resultEmitted = true;
      }
    }
  } catch (err) {
    hadError = true;
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Slash command error: ${errorMsg}`);
    writeOutput({ status: 'error', result: null, error: errorMsg });
  }

  log(`Slash command done. compactBoundarySeen=${compactBoundarySeen}, hadError=${hadError}`);

  if (!hadError && !compactBoundarySeen) {
    log('WARNING: compact_boundary was not observed. Compaction may not have completed.');
  }

  if (!resultEmitted && !hadError) {
    writeOutput({
      status: 'success',
      result: compactBoundarySeen
        ? 'Conversation compacted.'
        : 'Compaction requested but compact_boundary was not observed.',
      newSessionId: slashSessionId,
    });
  } else if (!hadError) {
    writeOutput({ status: 'success', result: null, newSessionId: slashSessionId });
  }
  return;
}
// --- End slash command handling ---
```

---

## Customizations

### External integration env injection (Athenaeum, Google Drive)

**Intent:** Inject credentials for two optional integrations into every container: Athenaeum (semantic memory MCP server) and Google Drive (OAuth for the google-drive container skill). All are read from `.env` and only injected if present — none are required.

**Files:** `src/container-runner.ts`

**How to apply:**

1. At the top of `src/container-runner.ts`, after the existing imports, add two `readEnvFile` calls:

```typescript
const atheneumEnv = readEnvFile(['ATHENAEUM_URL', 'ATHENAEUM_API_KEY']);
const googleDriveEnv = readEnvFile([
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
]);
```

2. In `buildContainerArgs`, after the line that pushes `ANTHROPIC_BASE_URL`, add the conditional env injections:

```typescript
// Athenaeum knowledge retrieval MCP server (personal Obsidian vault + memory)
if (atheneumEnv.ATHENAEUM_URL) {
  args.push('-e', `ATHENAEUM_URL=${atheneumEnv.ATHENAEUM_URL}`);
}
if (atheneumEnv.ATHENAEUM_API_KEY) {
  args.push('-e', `ATHENAEUM_API_KEY=${atheneumEnv.ATHENAEUM_API_KEY}`);
}

// Google Drive OAuth credentials (for google-drive container skill)
if (googleDriveEnv.GOOGLE_CLIENT_ID) {
  args.push('-e', `GOOGLE_CLIENT_ID=${googleDriveEnv.GOOGLE_CLIENT_ID}`);
}
if (googleDriveEnv.GOOGLE_CLIENT_SECRET) {
  args.push('-e', `GOOGLE_CLIENT_SECRET=${googleDriveEnv.GOOGLE_CLIENT_SECRET}`);
}
if (googleDriveEnv.GOOGLE_REFRESH_TOKEN) {
  args.push('-e', `GOOGLE_REFRESH_TOKEN=${googleDriveEnv.GOOGLE_REFRESH_TOKEN}`);
}
```

**Environment variables in `.env`:**
- `ATHENAEUM_URL` — HTTP MCP endpoint (e.g. `http://localhost:8080`)
- `ATHENAEUM_API_KEY` — Bearer token for Athenaeum (optional)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` — from `scripts/google-oauth.mjs`

---

### API usage tracking

**Intent:** Track all Claude API usage (tokens and estimated costs) in a SQLite table, captured transparently by the credential proxy. The proxy buffers API responses and extracts token usage from both streaming (SSE) and non-streaming (JSON) responses. Provides `getUsageSummary()` for billing dashboards.

**Files:** `src/db.ts`, `src/credential-proxy.ts`

**How to apply to `src/db.ts`:**

1. In the database schema initialization (in the `initDb` function or wherever migrations run), add the table creation:

```typescript
// API usage tracking table
database.exec(`
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
  )
`);
```

2. At the end of `src/db.ts`, add the full usage tracking exports:

```typescript
// --- API Usage Tracking ---

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
const MODEL_PRICING: Record<
  string,
  { input: number; output: number; cache_write: number; cache_read: number }
> = {
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4, cache_write: 1, cache_read: 0.08 },
  'claude-sonnet-4-6-20250514': { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  'claude-opus-4-6-20250610': { input: 15, output: 75, cache_write: 18.75, cache_read: 1.5 },
};

function estimateCost(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  if (!model) return 0;
  // Match by prefix to handle dated model IDs
  const pricing = Object.entries(MODEL_PRICING).find(([key]) =>
    model.startsWith(key.replace(/-\d{8}$/, '')),
  )?.[1];
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
  db.prepare(
    `INSERT INTO api_usage (timestamp, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, estimated_cost_usd, request_path, status_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.timestamp, entry.model, entry.input_tokens, entry.output_tokens,
    entry.cache_creation_input_tokens, entry.cache_read_input_tokens,
    entry.estimated_cost_usd, entry.request_path, entry.status_code,
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
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens), 0) as total_input,
      COALESCE(SUM(output_tokens), 0) as total_output,
      COALESCE(SUM(cache_creation_input_tokens), 0) as total_cache_write,
      COALESCE(SUM(cache_read_input_tokens), 0) as total_cache_read,
      COALESCE(SUM(estimated_cost_usd), 0) as total_cost,
      COUNT(*) as request_count
    FROM api_usage WHERE timestamp >= ?`).get(sinceIso) as any;

  const byModel = db.prepare(`
    SELECT model,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(estimated_cost_usd), 0) as estimated_cost_usd,
      COUNT(*) as request_count
    FROM api_usage WHERE timestamp >= ?
    GROUP BY model ORDER BY estimated_cost_usd DESC`).all(sinceIso) as any[];

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

export { estimateCost };
```

**How to apply to `src/credential-proxy.ts`:**

Add imports:
```typescript
import { estimateCost, logApiUsage } from './db.js';
```

Add the `extractAndLogUsage` function (called from the proxy response handler to capture token data from both SSE and JSON responses):

```typescript
function extractAndLogUsage(body: string, upRes: IncomingMessage, requestPath: string): void {
  const statusCode = upRes.statusCode || 0;
  if (statusCode < 200 || statusCode >= 300) return;

  const contentType = upRes.headers['content-type'] || '';
  let model: string | null = null;
  let inputTokens = 0, outputTokens = 0, cacheWriteTokens = 0, cacheReadTokens = 0;

  if (contentType.includes('text/event-stream')) {
    for (const line of body.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;
      try {
        const event = JSON.parse(data);
        if (event.type === 'message_start' && event.message) {
          model = event.message.model || null;
          if (event.message.usage) {
            inputTokens += event.message.usage.input_tokens || 0;
            cacheWriteTokens += event.message.usage.cache_creation_input_tokens || 0;
            cacheReadTokens += event.message.usage.cache_read_input_tokens || 0;
          }
        }
        if (event.type === 'message_delta' && event.usage) {
          outputTokens += event.usage.output_tokens || 0;
        }
      } catch { /* skip */ }
    }
  } else {
    try {
      const json = JSON.parse(body);
      model = json.model || null;
      if (json.usage) {
        inputTokens = json.usage.input_tokens || 0;
        outputTokens = json.usage.output_tokens || 0;
        cacheWriteTokens = json.usage.cache_creation_input_tokens || 0;
        cacheReadTokens = json.usage.cache_read_input_tokens || 0;
      }
    } catch { return; }
  }

  if (inputTokens + outputTokens === 0) return;

  logApiUsage({
    timestamp: new Date().toISOString(),
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheWriteTokens,
    cache_read_input_tokens: cacheReadTokens,
    estimated_cost_usd: estimateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens),
    request_path: requestPath,
    status_code: statusCode,
  });
}
```

Call `extractAndLogUsage(bufferedBody, upRes, requestPath)` at the point where the proxy has fully buffered the upstream response body (after SSE stream ends or JSON body complete).

---

### Remove CI workflows

**Intent:** Remove the upstream's automated version bump and token update workflows. These ran on PRs and were not needed in the personal fork.

**Files:** `.github/workflows/bump-version.yml`, `.github/workflows/update-tokens.yml`

**How to apply:**

```bash
rm .github/workflows/bump-version.yml
rm .github/workflows/update-tokens.yml
```

---

### package.json: Google and Telegram dependencies

**Intent:** Add npm packages needed by the Gmail channel (googleapis, google-auth-library) and Telegram channel (grammy). These come with the gmail/telegram remote merges but are documented here for verification.

**Files:** `package.json`

**How to apply:**

After merging `telegram/main` and `gmail/main`, verify these are in `package.json`:
- `"google-auth-library"` — Google OAuth2 client
- `"googleapis"` — Google APIs client
- `"grammy"` — Telegram bot framework

If missing, add them: `npm install google-auth-library googleapis grammy`

---

## Custom Container Skills

**Intent:** The entire `container/skills/` directory is custom — all domain-specific agents for personal productivity. These are NOT from upstream skill branches and must be copied wholesale from the main tree.

**Files:** `container/skills/` (entire directory)

**How to apply:**

```bash
cp -r "$MAIN_TREE/container/skills" "$WORKTREE/container/"
```

The skills directory contains these domain agents (all with `SKILL.md` files):

| Skill | Purpose |
|-------|---------|
| `curator` | Readwise library organization specialist |
| `curator-daily-digest` | Daily 6:15 AM reading categorization |
| `curator-weekly-cleanup` | Saturday 8 AM library maintenance |
| `google-drive` | Google Drive file access via `gdrive.mjs` |
| `knowledge-retrieval` | Athenaeum semantic memory access |
| `minerva-evening-review` | 9 PM daily reflection and memory save |
| `morning-update` | 6:45 AM morning dashboard briefing |
| `nourish` | Nutrition/sleep/recovery specialist |
| `nourish-daily-checkin` | 9:15 PM health data check-in (Apple Health via Drive) |
| `nourish-morning-actions` | Morning recovery-based action items |
| `nourish-morning-recap` | Morning yesterday's health summary |
| `nourish-weekly-review` | Weekly health trends aggregation |
| `obsidian-cli` | Obsidian vault interaction |
| `praxis` | Habits and practice specialist |
| `praxis-cli` | Habit tracking CLI wrapper |
| `praxis-evening-checkin` | Evening habit completion logging |
| `praxis-morning-reminder` | Morning habit reminder with values context |
| `praxis-weekly-review` | Sunday evening habits adherence review |
| `scholar` | Reading/learning/retention specialist |
| `scholar-daily-checkin` | 9 PM daily reading check-in |
| `scholar-morning-recall` | 6:50 AM weekday active recall session |
| `scholar-weekly-deep` | Saturday 10 AM synthesis and deep review |
| `sentinel` | Network security monitoring specialist |
| `sentinel-nmap-report` | Daily nmap scan triage and reporting |
| `wiki` | Personal knowledge wiki system |
| `wiki-lint` | Weekly wiki health audit |

**Key infrastructure these skills depend on:**
- Obsidian vault at `/workspace/extra/Mark-main/` (mounted via `containerConfig.additionalMounts`)
- Praxis CLI binary at `/workspace/extra/praxis/dist/index.js`
- Google Drive API credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`)
- Athenaeum MCP server (`ATHENAEUM_URL`, `ATHENAEUM_API_KEY`)
- nmap scan output at `~/Documents/Mark-main/Security/nmap/latest.json` (written by host cron)

---

## Group Configurations

### groups/global/CLAUDE.md

**Intent:** Global assistant personality and memory protocol shared across all agent groups. Defines the three-layer memory system (Wiki → Athenaeum → Conversation Archives), retrieval/write protocols, message formatting per channel, and task script guidance.

**Files:** `groups/global/CLAUDE.md`

**How to apply:** Copy from main tree:

```bash
cp "$MAIN_TREE/groups/global/CLAUDE.md" "$WORKTREE/groups/global/CLAUDE.md"
```

This file is the primary source of truth for agent behavior. It must be copied exactly — do not regenerate it. Key sections:
- Assistant name: Andy
- Three-layer memory: Wiki at `/workspace/extra/Mark-main/wiki/`, Athenaeum MCP tools, Conversation Archives
- Retrieval decision tree
- Write protocol: "Wiki tracks state. Athenaeum stores episodes."
- Channel formatting: Slack mrkdwn, WhatsApp/Telegram `*bold*`, Discord standard Markdown
- Task script pattern (bash check → JSON `{wakeAgent, data}` → conditional agent wake)

### groups/main/CLAUDE.md

**Intent:** Extended instructions for the main/admin control group. Includes group management (register/remove/list), admin notes on authentication (long-lived OAuth tokens vs short-lived keychain tokens), container mount map, sender allowlist configuration, anti-hallucination rules for scheduling.

**Files:** `groups/main/CLAUDE.md`

**How to apply:** Copy from main tree:

```bash
cp "$MAIN_TREE/groups/main/CLAUDE.md" "$WORKTREE/groups/main/CLAUDE.md"
```

---

## Scripts

### scripts/google-oauth.mjs

**Intent:** One-time OAuth2 flow for Google Drive. Runs a local HTTP server on port 8976 to capture the redirect, exchanges for a refresh token, and outputs `GOOGLE_REFRESH_TOKEN=...` for `.env`. Usage: `node scripts/google-oauth.mjs <client_id> <client_secret>`. Required scopes: `https://www.googleapis.com/auth/drive`.

**How to apply:** Copy from main tree:

```bash
cp "$MAIN_TREE/scripts/google-oauth.mjs" "$WORKTREE/scripts/google-oauth.mjs"
```

### scripts/sentinel/nmap-scan.sh and parse-nmap.mjs

**Intent:** Host-side LAN security scanning pair. `nmap-scan.sh` runs as a systemd timer on the host (not in container), scans subnet `192.168.50.0/24`, outputs XML + JSON summary to `~/Documents/Mark-main/Security/nmap/`. `parse-nmap.mjs` converts nmap XML to the compact JSON format that `sentinel-nmap-report` skill reads.

**Note:** `nmap-scan.sh` hardcodes node path to `/home/sophist/.nvm/versions/node/v22.22.2/bin` — update if node version changes.

**How to apply:** Copy from main tree:

```bash
mkdir -p "$WORKTREE/scripts/sentinel"
cp "$MAIN_TREE/scripts/sentinel/nmap-scan.sh" "$WORKTREE/scripts/sentinel/"
cp "$MAIN_TREE/scripts/sentinel/parse-nmap.mjs" "$WORKTREE/scripts/sentinel/"
```

The host systemd timer (not managed by NanoClaw) must also be configured separately to run `nmap-scan.sh` on a schedule and call `parse-nmap.mjs` to generate `latest.json`.

---

## Required Environment Variables

For reference, all `.env` keys this fork uses (in addition to standard NanoClaw keys):

| Key | Required | Purpose |
|-----|----------|---------|
| `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | Yes | Anthropic auth |
| `ONECLI_URL` | If using OneCLI | OneCLI gateway URL |
| `TELEGRAM_BOT_TOKEN` | If using Telegram | Main Telegram bot |
| `ATHENAEUM_URL` | Optional | Semantic memory server |
| `ATHENAEUM_API_KEY` | Optional | Athenaeum bearer token |
| `GOOGLE_CLIENT_ID` | Optional | Google Drive OAuth |
| `GOOGLE_CLIENT_SECRET` | Optional | Google Drive OAuth |
| `GOOGLE_REFRESH_TOKEN` | Optional | Google Drive (from `scripts/google-oauth.mjs`) |
