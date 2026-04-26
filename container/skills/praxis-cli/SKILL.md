---
name: praxis
description: Use when the user asks to track habits, mark a habit done/skipped, see what's due today, check streaks, list missed habits, or manage a "parking lot" of deferred ideas. Drives the praxis CLI at /workspace/extra/praxis/dist/index.js with vault at /workspace/extra/Mark-main. Trigger on phrases like "log my run", "mark X complete", "what's due", "my streak for Y", "park this idea", "promote that parking item to a habit".
---

# Praxis CLI

Praxis is a local CLI that tracks habits and "parking lot" items. All data is written as markdown + YAML frontmatter inside the user's Obsidian vault, so files are inspectable in Obsidian and diffable in git.

## Before you start — preflight check

1. The praxis binary is at `/workspace/extra/praxis/dist/index.js`. Always invoke it as:
   ```
   node /workspace/extra/praxis/dist/index.js <command>
   ```

2. The vault is mounted at `/workspace/extra/Mark-main`. Always pass `--vault /workspace/extra/Mark-main` on every invocation (or set `PRAXIS_VAULT=/workspace/extra/Mark-main` for the session).

3. Always parse the JSON output. Default mode IS JSON — do NOT pass `--pretty` from a script or agent flow. `--pretty` is human-only.

## Output contract

**Success** (stdout, single JSON value, newline-terminated):
- Single object for `add`/`show`/`edit`/`complete`/`uncomplete`/`promote`/`streak`:
  ```json
  { "id": "hab_01...", "title": "Morning run", "schedule": { "type": "daily" }, ... }
  ```
- Array for `list`/`due`/`missed`:
  ```json
  [ { "id": "...", ... }, ... ]
  ```

**Error** (stderr, never stdout):
```json
{ "error": { "code": "<ERROR_CODE>", "message": "...", "details": {} } }
```

Stdout and stderr never mix. If a command fails you get a non-zero exit; parse stderr for the error code.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Unexpected internal error |
| 2 | Invalid input (bad args, schedule, date format, traversal id, conflicting `--json`/`--pretty`) |
| 3 | Vault config error (`VAULT_NOT_CONFIGURED`, `VAULT_NOT_FOUND`) |
| 4 | Not found (habit/parking item id absent) |
| 5 | Conflict (`ALREADY_RECORDED`, `ALREADY_PROMOTED`) |
| 9 | Lock timeout (another praxis process held the vault lock too long) |

## Commands

### Habits

```
praxis habits add        --title <str> --schedule <json> [--tags <csv>] [--notes <str>]
praxis habits list       [--all]
praxis habits show       <id>
praxis habits edit       <id> [--title <str>] [--schedule <json>] [--tags <csv>] [--status active|archived] [--notes <str>]
praxis habits remove     <id> [--force]
praxis habits due        [--date <YYYY-MM-DD>] [--include-done]
praxis habits missed     [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
praxis habits streak     <id>
praxis habits complete   <id> [--date <YYYY-MM-DD>] [--status completed|skipped]
praxis habits uncomplete <id> [--date <YYYY-MM-DD>]
```

Notes:
- `--date` defaults to today (local TZ). Format is strict `YYYY-MM-DD`; anything else is rejected with `INVALID_DATE_FORMAT` (exit 2).
- `complete` accepts past dates up to **7 days back**; older = `DATE_TOO_FAR_PAST` (exit 2). Future dates = `FUTURE_DATE` (exit 2).
- `complete` with `--status skipped` records a skip (counts as "satisfied for the day" but distinct from a completion).
- `remove` without `--force` returns `FORCE_REQUIRED` (exit 2) — agents should always pass `--force` when the user has clearly authorized deletion.
- `uncomplete` removes a completion/skip row for the given date.

### Parking lot

```
praxis parking add      --title <str> [--tags <csv>] [--notes <str>]
praxis parking list     [--all]
praxis parking show     <id>
praxis parking edit     <id> [--title <str>] [--tags <csv>] [--notes <str>]
praxis parking remove   <id> [--force]
praxis parking promote  <id> --schedule <json> [--title <str>]
```

`promote` converts a parking item into an active habit. The original parking item is marked `promoted` and the new habit's frontmatter records `promoted_from: <park_id>`. History does not carry over.

### Global flags

| Flag | Purpose |
|------|---------|
| `--vault <path>` | Override `$PRAXIS_VAULT` for this invocation |
| `--json` | JSON output (default — usually omit) |
| `--pretty` | Human-readable output (avoid in scripts/agents) |
| `--date <YYYY-MM-DD>` | Date for date-sensitive subcommands |

## Schedule grammar

Pass `--schedule` as a JSON string. All types:

| Type | Shape | Meaning |
|------|-------|---------|
| `daily` | `{"type":"daily"}` | Every day |
| `weekly` | `{"type":"weekly","days":["Monday","Wednesday","Friday"]}` | On named weekdays (Monday–Sunday, case-insensitive) |
| `monthly_day` | `{"type":"monthly_day","day":15}` | On day-of-month (1–28 only — Feb edge cases excluded) |
| `interval` | `{"type":"interval","every_n_days":3,"start_date":"2026-04-24"}` | Every N days from start |
| `at_least` | `{"type":"at_least","n":3,"period":"week"}` | At least N completions per calendar period (`week`/`month`/`quarter`/`year`) |
| `periodic` | `{"type":"periodic","period":"quarter"}` | Once per calendar period |

Optional `time_window` on any schedule (informational; does not affect due-date logic):
```json
{"type":"daily","time_window":{"before":"09:00"}}
{"type":"weekly","days":["Sunday"],"time_window":{"label":"evening"}}
```

**Period semantics**: `week` = ISO 8601 (Mon–Sun). `month`/`quarter`/`year` = calendar boundaries. Completions are bucketed by their local-TZ calendar date.

## Common agent workflows

### "What should I do today?"
```
praxis habits due
```
Returns array of habits due for today (local TZ), each with `id`, `title`, `schedule`, `due_date`, `already_completed`. Filter or summarize for the user.

### "Mark X complete"
1. If you have the id already, use it. If not, run `praxis habits list` and match the title.
2. ```
   praxis habits complete <id>
   ```
3. Confirm via the returned `{ habit_id, date, status: "completed", timestamp_utc }`.

### "What did I miss this week?"
```
praxis habits missed --from 2026-04-19 --to 2026-04-25
```

### "How's my streak on X?"
```
praxis habits streak <id>
```
Returns `{ id, title, current_streak, longest_streak, streak_unit }`. `streak_unit` is the singular period word (`day`/`week`/`month`/`quarter`/`year`).

### "Park this idea"
```
praxis parking add --title "Try Obsidian Canvas" --tags ideas --notes "Saw a video about it"
```

### "Promote that parking item to a daily habit"
```
praxis parking promote <park_id> --schedule '{"type":"daily"}'
```

### Adding a habit from a fuzzy human request
- "Run every Monday and Thursday" → `{"type":"weekly","days":["Monday","Thursday"]}`
- "Read at least 3x a week" → `{"type":"at_least","n":3,"period":"week"}`
- "Pay rent on the 1st" → `{"type":"monthly_day","day":1}`
- "Do laundry every 3 days starting today" → `{"type":"interval","every_n_days":3,"start_date":"<today YYYY-MM-DD>"}`
- "Quarterly review" → `{"type":"periodic","period":"quarter"}`
- "Daily standup before 9am" → `{"type":"daily","time_window":{"before":"09:00"}}`

## Error codes you'll see

| Code | When | What to do |
|------|------|-----------|
| `VAULT_NOT_CONFIGURED` | `PRAXIS_VAULT` unset and no `--vault` | Ask user for vault path |
| `VAULT_NOT_FOUND` | Vault path doesn't exist | Confirm path with user |
| `INVALID_INPUT` | Malformed id (e.g., path traversal attempt), bad arg | Re-check the id you passed |
| `INVALID_DATE_FORMAT` | `--date` not strict `YYYY-MM-DD` | Reformat the date |
| `INVALID_SCHEDULE` | Schedule JSON failed validation | Re-read schedule grammar above; the `details` field usually names the offending field |
| `NOT_FOUND` | id doesn't exist in the vault | List habits/parking and find the real id |
| `ALREADY_RECORDED` | Trying to complete/skip a habit already recorded for that date | Use `uncomplete` first if you need to change it |
| `ALREADY_PROMOTED` | Promoting a parking item that was already promoted | No-op |
| `FORCE_REQUIRED` | Destructive action without `--force` | Add `--force` if user authorized |
| `FUTURE_DATE` | Trying to complete a future date | Don't backdate to the future |
| `DATE_TOO_FAR_PAST` | Backdate completion >7 days | Tell user the 7-day cap |
| `LOCK_TIMEOUT` | Another praxis process held the vault lock | Retry once after a moment |

## Don'ts

- **Don't pass `--pretty`** from a script or agent flow. The output is unparseable that way.
- **Don't construct file paths yourself** under `<vault>/Praxis/...`. Always use the CLI; it handles atomic writes and the vault lock. Reading the markdown directly is fine for inspection.
- **Don't invent ids**. Always get them from `list`/`add`/`show` output. Ids are ULIDs prefixed `hab_` or `park_`.
- **Don't auto-delete habits** without explicit user confirmation, even if they say "remove the old ones." Confirm which ones first.
- **Don't backdate completions arbitrarily**. The 7-day cap is enforced; older edits require the user to edit the markdown file directly.

## Vault layout (read-only reference)

```
<vault>/Praxis/
  habits/<hab_ULID>.md          # YAML frontmatter + optional ## Notes body
  parking-lot/<park_ULID>.md    # same shape
  completions/YYYY-MM-DD.md     # # date heading + markdown table of completions
  .praxis.lock                  # advisory flock — don't touch
```

You can read these files directly to debug or summarize, but always write through the CLI.
