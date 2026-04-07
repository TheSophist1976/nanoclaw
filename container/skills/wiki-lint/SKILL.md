---
name: wiki-lint
description: Wiki health check and cleanup. Runs weekly to find and fix contradictions, orphans, gaps, stale content, and index drift. Background task — fixes directly, no user interaction.
---

# Wiki Lint

This is a **background task**. You are auditing and cleaning the wiki without user interaction. Fix issues directly when you can; flag the rest in the report.

## Goals

Run a comprehensive health check on `/workspace/extra/Mark-main/wiki/` and fix what you can autonomously. Write a full report to disk.

## Step 1: Read the wiki

1. Read `wiki/index.md`
2. List all wiki pages: `find /workspace/extra/Mark-main/wiki -name "*.md" -type f`
3. Read each page (one at a time, fully)

## Step 2: Audit each page against the wiki philosophy

Per `/wiki` skill rules, wiki pages should hold **stable curated facts**, not state. For each page, check:

### Critical violations (state leaking into wiki)

- **Recent values, dates, or snapshots** that will be wrong tomorrow (e.g. "Recent Status: Mar 24: 81 fl oz logged")
- **Day-by-day logs** of activity (e.g. "Apr 6 (Day 1): hands to shins")
- **"Days remaining" countdowns** that need to be updated daily
- **Current page numbers, current weights, current HRV values** — these change constantly
- **"This week" or "this month" snapshots** of priorities that are time-bound

These should be removed from the wiki. The data lives in Athenaeum (queryable) — the wiki should reference the *what* (e.g. "HRV is tracked via Athlytic; baseline ~50 ms range") not the *current value*.

### Other violations

- **Speculative content** ("TBD", "[Unknown]", placeholder text)
- **Index drift** — pages that exist but aren't in `wiki/index.md`
- **Orphans** — pages that nothing else references via `[[wikilinks]]`
- **Missing cross-references** — pages that mention concepts on other pages but don't link them
- **Contradictions** — two pages disagreeing about a fact

## Step 3: Fix what you can

For each issue, fix it directly:

| Issue | Fix |
|-------|-----|
| State data in wiki | Strip the time-sensitive section, leave the stable facts |
| Speculative content (TBD) | Remove the section or mark it clearly as deferred |
| Index drift | Add the missing page to `wiki/index.md` |
| Missing cross-references | Add `[[page-name]]` links where appropriate |
| Contradictions | Pick the more recent/accurate version, remove the contradicting text |
| Orphans | Either add references from other pages or note the orphan in the report |

**Important:** Make targeted edits. Don't rewrite entire pages for small fixes. Preserve the page's original structure and intent.

## Step 4: Write the report

Create `/workspace/extra/Mark-main/wiki/lint-reports/lint-YYYY-MM-DD.md` with the full report.

```bash
mkdir -p /workspace/extra/Mark-main/wiki/lint-reports
```

Format:

```markdown
# Wiki Lint — YYYY-MM-DD

## Summary
- Pages audited: N
- Issues found: N
- Fixed automatically: N
- Flagged for review: N

## Fixed
- `path/to/page.md` — what was fixed (one line each)

## Flagged for review
- `path/to/page.md` — what needs attention and why you didn't auto-fix it

## Wiki health
- Total pages: N
- Index coverage: N/N
- Cross-reference density: average inbound links per page
- Domains: list with page counts
```

## Step 5: Append to log

Append a summary to `/workspace/extra/Mark-main/wiki/log.md`:

```markdown
## [YYYY-MM-DD] lint | Weekly health check
- Pages audited: N
- Fixed: N
- Flagged for review: N (see lint-reports/lint-YYYY-MM-DD.md)
```

## Rules

- This is a background task. Do NOT send any messages to Mark.
- Fix what you can autonomously — don't ask for permission.
- For ambiguous cases (e.g. "is this a fact or state?"), err toward keeping the content but flag it in the report.
- Always read a page before editing it.
- Make targeted edits — don't rewrite for small changes.
- Update `wiki/index.md` if any pages were created, deleted, or had their summaries change materially.
- Do NOT mention this is a scheduled task in the report or log.
