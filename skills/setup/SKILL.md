---
name: melxis-setup
description: Verify a freshly installed Melxis plugin and find the hive for the user's work. Use during plugin onboarding, right after installing or signing in to Melxis, or when the user asks to check the setup or the connection ("does Melxis work", "set up Melxis", "Melxis つながってる？"). Read-only; it never writes.
---

# Set up Melxis

Verify the connection with read-only MCP calls. A linked computer, local files, and a shell are not required.

1. Use the project or area the user has already named. If it is unclear, ask what work they want to continue with Melxis.
2. Call `hive_search` for that area. Identify hives by id and `own`, since names can repeat across accounts.
3. With a matching own hive, read `hive_context_get` for its guide (how work is done there), the mels it points at, and its recent activity (the 10 most recently touched tasks, with who last touched each); then `task_search(hive_id, sort: "recency", limit: 10)` for the same picture, unless that response already carried `recent_activity` (older servers do not return one). Search relevant mels with `mel_search` and read a full body with `mel_get` when its summary says you need it. Read `task_get` only when the user asks to continue tracked work.
4. With only shared hives, search accessible mels with `mel_search`. Shared hives are read-only and expose neither tasks nor their owner's guide.
5. With no matching hive, say that the connection works but this work has no matching hive yet. At the first save-worthy moment, propose a name and purpose and wait for agreement before creating one with `hive_create`.

Report what was actually verified — which calls succeeded, which hive was found — and offer one useful next action based on the results, such as continuing a task or recalling a decision. For ongoing recall and saves, use the **melxis-memory** skill; for cross-session work, use **melxis-task**.

## Clients without hooks

In clients that run no lifecycle hooks (a plugin installed from a directory, ChatGPT), nothing reminds the agent to read the hive at the start of a conversation. Offer the user this line for their custom or project instructions, so the guide and recent activity are read before work in that hive begins:

> When I start project work, first call hive_search for the project; if a hive I own matches, call hive_context_get for it, then search Melxis mels for anything that bears on the work and use it. Keep this silent unless it changes the answer.

## If something fails

If a tool is unavailable or authentication fails, say that verification did not succeed and ask the user to connect or sign in to Melxis in their client's plugin settings. Retry after they confirm. On Codex CLI, suggest `codex mcp login melxis`. Installing the package alone does not verify the connection, and setup does not guarantee that every later session reads the hive.
