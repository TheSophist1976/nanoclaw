---
name: praxis
description: Use when the user asks to track habits, mark a habit done/skipped, see what's due today, check streaks, list missed habits, manage a "parking lot" of deferred ideas, or manage their Core Beliefs, Core Values, and Standards (the value-system anchors for habits). Drives the praxis CLI binary at /workspace/extra/praxis-bin with vault at /workspace/extra/Mark-main. Trigger on phrases like "log my run", "mark X complete", "what's due", "my streak for Y", "park this idea", "promote that parking item to a habit", "add a core belief", "what value does this habit serve", "set a standard for X".
---

# Praxis CLI

Praxis is a local CLI that tracks habits, "parking lot" items, and a personal value system (Core Beliefs → Core Values → Habits, with optional Standards as measurable targets). All data is written as markdown + YAML frontmatter inside the user's Obsidian vault, so files are inspectable in Obsidian and diffable in git.

## Hierarchy

```
Belief         (root; no required parent)
  └── Value    (must reference exactly one Belief)
        ├── Habit     (must link to ≥1 Value when created)
        └── Standard  (optional; references exactly one Value; pure reference, no tracking yet)
```

A Habit can also link to a single Standard, but only one whose `value_id` is in the Habit's value list.

## Before you start — preflight check

1. The praxis binary is mounted read-only at `/workspace/extra/praxis-bin`. Always invoke it by full path:
   ```
   /workspace/extra/praxis-bin <command>
   ```
   It is a single-file Bun-compiled binary — there is no `node` or `dist/index.js` indirection.

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
| 4 | Not found (habit/parking/belief/value/standard id absent) |
| 5 | Conflict (`ALREADY_RECORDED`, `ALREADY_PROMOTED`, `ARCHIVE_BLOCKED`, `REMOVE_BLOCKED`, `INVALID_REFERENCE`) |
| 9 | Lock timeout (another praxis process held the vault lock too long) |

## Commands

### Habits

```
/workspace/extra/praxis-bin habits add        --title <str> --schedule <json> --value <val-id-csv> [--standard <std-id>] [--tags <csv>] [--notes <str>]
/workspace/extra/praxis-bin habits list       [--all]
/workspace/extra/praxis-bin habits show       <id>
/workspace/extra/praxis-bin habits edit       <id> [--title <str>] [--schedule <json>] [--tags <csv>] [--status active|archived] [--notes <str>] [--values <val-id-csv>] [--standard <std-id> | --clear-standard]
/workspace/extra/praxis-bin habits remove     <id> [--force]
/workspace/extra/praxis-bin habits due        [--date <YYYY-MM-DD>] [--include-done]
/workspace/extra/praxis-bin habits missed     [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]
/workspace/extra/praxis-bin habits streak     <id>
/workspace/extra/praxis-bin habits complete   <id> [--date <YYYY-MM-DD>] [--status completed|skipped]
/workspace/extra/praxis-bin habits uncomplete <id> [--date <YYYY-MM-DD>]
```

Notes:
- `--date` defaults to today (local TZ). Format is strict `YYYY-MM-DD`; anything else is rejected with `INVALID_DATE_FORMAT` (exit 2).
- `complete` accepts past dates up to **7 days back**; older = `DATE_TOO_FAR_PAST` (exit 2). Future dates = `FUTURE_DATE` (exit 2).
- `complete` with `--status skipped` records a skip (counts as "satisfied for the day" but distinct from a completion).
- `remove` without `--force` returns `FORCE_REQUIRED` (exit 2) — agents should always pass `--force` when the user has clearly authorized deletion.
- `uncomplete` removes a completion/skip row for the given date.
- **`add` requires `--value`** with at least one `val_<ulid>`; comma-separated for multiple. Empty string → `INVALID_INPUT`. Archived values → `INVALID_REFERENCE` (exit 5).
- `--standard` (on `add` or `edit`) must reference a Standard whose `value_id` is in the habit's value list, else `INVALID_REFERENCE` (exit 5). Use `--clear-standard` (mutually exclusive with `--standard`) to unlink.
- `--values` on `edit` **replaces** the entire value list (not additive). If the habit has a linked Standard whose `value_id` would no longer be in the new list, the edit is refused — update or clear `--standard` first.
- `habits show` enriches each value with its Belief (`values[].belief = { id, title }`) and resolves the linked Standard. Legacy habits that pre-date this feature return `value_ids: []` with no warning.

### Parking lot

```
/workspace/extra/praxis-bin parking add      --title <str> [--tags <csv>] [--notes <str>]
/workspace/extra/praxis-bin parking list     [--all]
/workspace/extra/praxis-bin parking show     <id>
/workspace/extra/praxis-bin parking edit     <id> [--title <str>] [--tags <csv>] [--notes <str>]
/workspace/extra/praxis-bin parking remove   <id> [--force]
/workspace/extra/praxis-bin parking promote  <id> --schedule <json> [--title <str>]
```

`promote` converts a parking item into an active habit. The original parking item is marked `promoted` and the new habit's frontmatter records `promoted_from: <park_id>`. History does not carry over.

### Beliefs

```
/workspace/extra/praxis-bin beliefs add    --title <str> [--tags <csv>] [--notes <str>]
/workspace/extra/praxis-bin beliefs list   [--all]
/workspace/extra/praxis-bin beliefs show   <id>
/workspace/extra/praxis-bin beliefs edit   <id> [--title <str>] [--tags <csv>] [--notes <str>] [--archived true|false]
/workspace/extra/praxis-bin beliefs remove <id>
```

- IDs are prefixed `bel_`.
- `edit --archived true` is refused (`ARCHIVE_BLOCKED`, exit 5) if any active Value still references the Belief. Archive child Values first, or restore the Belief later.
- `remove` is refused (`REMOVE_BLOCKED`, exit 5) if any Value (active OR archived) references the Belief. Delete or reassign Values first.

### Values

```
/workspace/extra/praxis-bin values add    --title <str> --belief <bel-id> [--tags <csv>] [--notes <str>]
/workspace/extra/praxis-bin values list   [--all] [--belief <bel-id>]
/workspace/extra/praxis-bin values show   <id>
/workspace/extra/praxis-bin values edit   <id> [--title <str>] [--tags <csv>] [--notes <str>] [--archived true|false]
/workspace/extra/praxis-bin values remove <id>
```

- IDs are prefixed `val_`. `--belief` is required at creation and cannot be retargeted via `edit` (Belief→Value linkage is immutable; create a new Value if needed).
- `edit --archived true` is refused if any active Habit's `value_ids` still contains this Value, or any active Standard references it.
- `remove` is refused if any Habit (any status) lists this Value, or any Standard (any status) references it.
- `values show` includes the resolved Belief in `belief: { id, title }`.

### Standards

```
/workspace/extra/praxis-bin standards add    --title <str> --value <val-id> [--target <number> --unit <str> --period daily|weekly|monthly|yearly] [--tags <csv>] [--notes <str>]
/workspace/extra/praxis-bin standards list   [--all] [--value <val-id>]
/workspace/extra/praxis-bin standards show   <id>
/workspace/extra/praxis-bin standards edit   <id> [--title <str>] [--target <number>] [--unit <str>] [--period <p>] [--tags <csv>] [--notes <str>] [--archived true|false]
/workspace/extra/praxis-bin standards remove <id>
```

- IDs are prefixed `std_`. `--value` is required at creation and immutable on `edit`.
- The `target/unit/period` triple is **all-or-nothing**: provide all three, or none. Partial sets → `INVALID_INPUT`. `target` must be a finite positive number; `period` must be one of `daily|weekly|monthly|yearly`.
- On `edit`, supplying any of `target`/`unit`/`period` requires the resulting frontmatter to be either complete (all three present) or absent (none present). The edit is refused otherwise.
- `remove` does NOT block when habits reference this Standard — it succeeds and emits a `DANGLING_STANDARD_REF` warning to stderr (exit 0). Surface the warning so the user can clean up the habits' `standard_id`.
- Standards are **pure references** today; they don't drive completion or due-date logic. Track progress via the linked Habit's completions.

### Version

`--version` does **not** require `PRAXIS_VAULT` and does **not** acquire the vault lock.

```
/workspace/extra/praxis-bin --version          # print version string (e.g. "0.1.1"), exit 0
/workspace/extra/praxis-bin --version --json   # { "version": "0.1.1" }, exit 0
```

There is no built-in self-update. The binary is mounted read-only inside this container, so it cannot upgrade itself anyway. To upgrade, the user rebuilds the binary on the host (`cd ~/praxis && bun build --compile --target=bun-linux-x64 ...`) and replaces `/home/sophist/.local/bin/praxis`. Don't attempt to upgrade praxis from inside this container.

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
/workspace/extra/praxis-bin habits due
```
Returns array of habits due for today (local TZ), each with `id`, `title`, `schedule`, `due_date`, `already_completed`. Filter or summarize for the user.

### "Mark X complete"
1. If you have the id already, use it. If not, run `/workspace/extra/praxis-bin habits list` and match the title.
2. ```
   /workspace/extra/praxis-bin habits complete <id>
   ```
3. Confirm via the returned `{ habit_id, date, status: "completed", timestamp_utc }`.

### "What did I miss this week?"
```
/workspace/extra/praxis-bin habits missed --from 2026-04-19 --to 2026-04-25
```

### "How's my streak on X?"
```
/workspace/extra/praxis-bin habits streak <id>
```
Returns `{ id, title, current_streak, longest_streak, streak_unit }`. `streak_unit` is the singular period word (`day`/`week`/`month`/`quarter`/`year`).

### "Park this idea"
```
/workspace/extra/praxis-bin parking add --title "Try Obsidian Canvas" --tags ideas --notes "Saw a video about it"
```

### "Promote that parking item to a daily habit"
```
/workspace/extra/praxis-bin parking promote <park_id> --schedule '{"type":"daily"}'
```

### "Anchor a habit to a value"
1. Make sure the user has at least one Belief and one Value:
   ```
   /workspace/extra/praxis-bin beliefs list
   /workspace/extra/praxis-bin values list
   ```
2. If they don't, walk them through: `beliefs add` → `values add --belief <bel_id>` → then `habits add ... --value <val_id>`.
3. To attach a measurable target, create a Standard first:
   ```
   /workspace/extra/praxis-bin standards add --title "Run 5x per week" --value <val_id> --target 5 --unit sessions --period weekly
   ```
   Then pass `--standard <std_id>` to `habits add`/`edit`.

### "What does this habit serve?"
```
/workspace/extra/praxis-bin habits show <hab_id>
```
The output's `values` array gives titles + nested Belief; `standard` (if linked) gives the target/unit/period. Use this to remind the user *why* the habit exists.

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
| `VAULT_NOT_CONFIGURED` | `PRAXIS_VAULT` unset and no `--vault` | Pass `--vault /workspace/extra/Mark-main` |
| `VAULT_NOT_FOUND` | Vault path doesn't exist | Confirm `/workspace/extra/Mark-main` is mounted (it should be) |
| `MISSING_REQUIRED_ARG` | A required flag was omitted entirely (e.g. `--title`, `--value` on `habits add`) | Add the flag |
| `INVALID_INPUT` | Malformed id (e.g., path traversal attempt), bad arg, empty `--value`, partial `target/unit/period` triple | Re-check what you passed |
| `INVALID_REFERENCE` | A referenced entity is missing, archived, or inconsistent (e.g. linking a Standard whose value isn't in the Habit's value list) | Read the message; fix the reference |
| `ARCHIVE_BLOCKED` | Archiving a Belief/Value/Standard blocked by active children | Archive children first, or leave parent active |
| `REMOVE_BLOCKED` | Deleting a Belief/Value blocked by referencing children (any status) | Reassign or delete the children first |
| `DANGLING_STANDARD_REF` | **Warning** (exit 0): a Standard was removed while habits still referenced it | Surface to user; they may want to `habits edit --clear-standard` on the affected habits |
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
- **Don't invent ids**. Always get them from `list`/`add`/`show` output. Ids are ULIDs prefixed `hab_`, `park_`, `bel_`, `val_`, or `std_`.
- **Don't auto-delete habits** without explicit user confirmation, even if they say "remove the old ones." Confirm which ones first.
- **Don't backdate completions arbitrarily**. The 7-day cap is enforced; older edits require the user to edit the markdown file directly.
- **Don't try to upgrade praxis from inside the container** — the binary is mounted read-only and there's no built-in self-update. Tell the user to rebuild on the host.

## Vault layout (read-only reference)

```
<vault>/Praxis/
  habits/<slug>--<prefix>.md       # YAML frontmatter + optional ## Notes body; filename is title-slug + ULID prefix
  parking-lot/<slug>--<prefix>.md  # same shape
  beliefs/<slug>--<prefix>.md      # bel_<ulid>, no parent ref
  values/<slug>--<prefix>.md       # val_<ulid>, frontmatter has belief_id
  standards/<slug>--<prefix>.md    # std_<ulid>, frontmatter has value_id (+ optional target/unit/period)
  completions/YYYY-MM-DD.md        # # date heading + markdown table of completions
  .praxis.lock                     # advisory flock — don't touch
```

A habit's frontmatter includes `value_ids: [val_...]` (array, even for one) and optional `standard_id`. Legacy habit files (pre-feature) omit both fields and continue to work; reads return `value_ids: []`.

You can read these files directly to debug or summarize, but always write through the CLI.
