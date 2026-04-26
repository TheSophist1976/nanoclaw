---
name: knowledge-retrieval
description: Retrieve personal knowledge from the user's Obsidian vault and memory via Athenaeum. Use before answering questions that may benefit from personal context, notes, or prior decisions.
---

# Knowledge Retrieval (Athenaeum)

You have access to the user's personal knowledge base — their Obsidian vault, chat history, and manually saved memories — via the Athenaeum MCP tools.

## When to use

Call `mcp__athenaeum__get_context` **before** answering any question that could benefit from personal context:

- Questions about the user's projects, preferences, decisions, or history
- Requests that reference prior conversations, notes, or documents
- Tasks where knowing the user's established patterns or past work would improve the answer
- When the user says "remember", "I wrote about", "in my notes", or similar

## Available tools

| Tool | Purpose |
|------|---------|
| `mcp__athenaeum__get_context` | **Primary.** Returns a formatted context block from the vault. Use this by default. Supports `verbosity`: `brief`, `standard`, `detailed` (default), `comprehensive`. |
| `mcp__athenaeum__search_memory` | Raw semantic search with relevance scores. Use when you need fine-grained control or want to see match quality. |
| `mcp__athenaeum__add_memory` | Save a new piece of knowledge to the vault. Use when the user asks you to remember something or when a decision worth preserving is made. |
| `mcp__athenaeum__list_sources` | List all indexed sources (Obsidian, chat history, etc.). |
| `mcp__athenaeum__sync_source` | Re-index a specific source. |

## Usage pattern

1. User asks a question with personal dimension
2. Call `get_context` with a search query capturing the intent
3. Incorporate the returned context into your response
4. If results are insufficient, try `search_memory` with a different query

## Do NOT use when

- The question is purely factual with no personal dimension (e.g., "what is TCP")
- You already have sufficient context from the conversation
- The user explicitly says not to check their notes
