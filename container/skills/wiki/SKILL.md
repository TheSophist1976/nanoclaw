---
name: wiki
description: Personal knowledge wiki system. Persistent, structured, interlinked markdown pages maintained by all MinervaOS specialists. Based on Karpathy's LLM Wiki pattern.
---

# Wiki — Personal Knowledge Base

A persistent wiki at `/workspace/extra/Mark-main/wiki/` that compounds knowledge over time. All MinervaOS specialists contribute to it. The wiki sits between raw sources and Mark — structured, interlinked, always current.

## Architecture

**Raw sources** (`/workspace/extra/Mark-main/sources/`) — immutable documents Mark provides (articles, PDFs, notes). Read but never modify.

**The wiki** (`/workspace/extra/Mark-main/wiki/`) — LLM-maintained markdown pages organized by domain. You own this entirely — create, update, cross-reference, maintain consistency.

**The schema** (this skill) — conventions and workflows for how to maintain the wiki.

## Directory Structure

```
wiki/
├── index.md          # Catalog of all pages with one-line summaries
├── log.md            # Chronological record of all wiki activity
├── life/             # Praxis: habits, values, parking lot, intentional practice
├── health/           # Nourish: protocols, nutrition, sleep, training
├── learning/         # Scholar: books, concepts, reading synthesis
├── systems/          # Sentinel: infrastructure, services, security
├── interests/        # Curator: reading patterns, feed sources, topics
└── people/           # Relationships, contacts, context
```

## Operations

### Ingest

When Mark provides a source (URL, file, text):

1. Read the source completely — do not summarize from metadata
2. Discuss key takeaways with Mark
3. For each relevant wiki page that should be updated or created:
   - Update existing pages with new information
   - Create new entity/concept pages as needed
   - Add cross-references (`[[page-name]]` wikilink style)
   - Flag contradictions with existing content
4. Update `wiki/index.md` — add new pages, update summaries
5. Append to `wiki/log.md`:
   ```
   ## [YYYY-MM-DD] ingest | Source Title
   - Pages created: list
   - Pages updated: list
   - Key takeaways: brief summary
   ```

**Ingest discipline:** Process sources ONE AT A TIME. For each source: read it fully, create/update all wiki pages, update index and log, then move to the next. Never batch-read multiple sources — this produces shallow, generic pages.

**URL handling:** `WebFetch` returns summaries, not full text. For wiki ingestion where full content matters, use bash to download:
```bash
curl -sLo /workspace/extra/Mark-main/sources/filename.pdf "<url>"
```
Or use `agent-browser` to open and extract full page text.

### Query

When Mark asks a question that the wiki can answer:

1. Read `wiki/index.md` first to locate relevant pages
2. Read the relevant pages
3. Synthesize an answer with references to wiki pages
4. If the answer reveals a gap, note it for future ingestion
5. If the answer is valuable enough to keep, file it as a new wiki page

### Lint

Periodic health check of the wiki:

1. **Contradictions** — scan for pages that disagree with each other
2. **Stale content** — pages that reference outdated information
3. **Orphans** — pages with no inbound cross-references
4. **Gaps** — important concepts referenced but lacking dedicated pages
5. **Missing cross-references** — related pages that should link to each other
6. **Index drift** — pages that exist but aren't in index.md

Report findings and offer to fix. Append to log:
```
## [YYYY-MM-DD] lint | Health check
- Issues found: N
- Fixed: list
- Flagged for review: list
```

## Auto-Update Guidelines

Specialists update wiki pages during their scheduled tasks. This is how the wiki compounds without manual effort.

### When to update

- **New information learned** — a fact, preference, decision, or status change
- **Contradiction detected** — Athenaeum or conversation reveals something that conflicts with a wiki page
- **Pattern emerged** — enough data points to write or update a synthesis page

### When NOT to update

- Ephemeral information (today's weather, a one-time reminder)
- Information already captured accurately in the wiki
- Speculative or unconfirmed information — wait for confirmation

### How to update

1. Read the existing page first
2. Make targeted edits — don't rewrite entire pages for small updates
3. Preserve existing cross-references
4. Add a brief note to `wiki/log.md` for significant updates
5. Update `wiki/index.md` only if a new page was created or a summary changed materially

### Specialist Domains

| Specialist | Wiki directory | What they maintain |
|------------|---------------|-------------------|
| **Praxis** | `wiki/life/` | Habits, values alignment, adherence tracking, parking lot, intentional practice |
| **Nourish** | `wiki/health/` | Nutrition protocols, sleep patterns, training schedule, supplements, body signals |
| **Scholar** | `wiki/learning/` | Book summaries, concept pages, reading goals, intellectual interests, retention notes |
| **Sentinel** | `wiki/systems/` | Machine inventory, network topology, service configs, security posture, known vulnerabilities |
| **Curator** | `wiki/interests/` | Reading patterns, feed source quality, topic map, information diet analysis |
| **Minerva** | `wiki/people/`, any | People context, cross-domain synthesis, anything that spans multiple domains |

### Athenaeum Integration

The wiki and Athenaeum serve different purposes:

- **Wiki** = curated, structured, current. Check first for known facts.
- **Athenaeum** = broad recall, raw. Use for searching conversation history, finding forgotten details, cross-referencing.

**Pattern:**
1. Check wiki pages for structured knowledge
2. Query Athenaeum when wiki doesn't have the answer or to verify wiki accuracy
3. If Athenaeum surfaces something that contradicts or extends the wiki → update the wiki
4. The wiki should reduce Athenaeum queries over time as knowledge gets curated

## Page Format

Wiki pages are plain markdown. Keep them practical:

```markdown
# Page Title

Brief description of what this page covers.

## Key Facts
- Fact 1
- Fact 2

## Details
Longer form content as needed.

## Cross-References
- See also: [[related-page]], [[other-page]]

## Sources
- Source 1 (date ingested)
- Source 2 (date ingested)

---
Last updated: YYYY-MM-DD
```

Use `[[wikilinks]]` for cross-references between pages. These are just text markers — they help the LLM and Mark navigate, even though they don't render as links outside Obsidian.
