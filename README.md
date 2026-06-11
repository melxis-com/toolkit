# Melxis Toolkit

**One mind. Many AIs. — shared memory and tasks for AI agents.**

[![Melxis — One mind. Many AIs.](assets/hero.png)](https://melxis.com)

What you tell one AI becomes context for another AI and your team — the next agent picks up where the last one left off.

[Melxis](https://melxis.com) keeps that context in **hives** — namespaces you can keep private or share with your team, so every member's agents draw on the same memory. Design decisions, bug analyses, and learnings live as **mels**, and multi-step work lives as **tasks**. The two feed each other — tasks reference related mels for context, and completed tasks return insights back to memory.

## Supported Platforms

Until Melxis is published to the official Anthropic / Codex marketplaces, installation is via direct GitHub reference. Choose your platform below.

For other AI clients, see the [Connect](https://melxis.com/#connect) section on melxis.com.

### Claude Code

In the Claude Code TUI, add the marketplace and install the plugin:

```
/plugin marketplace add melxis-com/toolkit
/plugin install melxis@melxis-com-toolkit
```

### Codex CLI

Codex's plugin hooks integration is still an under-development feature, so setup requires a few extra steps.

1. **Add the marketplace** (in your shell):

   ```sh
   codex plugin marketplace add melxis-com/toolkit
   ```

2. **Enable the plugin** — in the Codex TUI, open `/plugins` and turn **Melxis** on.

3. **Opt in to plugin hooks** (in your shell):

   ```sh
   codex features enable plugin_hooks
   ```

   This unlocks lifecycle hooks shipped by plugins. Codex will print a warning that the feature is under development; that is expected.

4. **Approve the bundled hooks** — in the Codex TUI, open `/hooks` and approve `SessionStart`, `Stop`, and `TaskCompleted`. Codex blocks plugin hooks from running until you approve them once. Approval is tied to the hook definitions, so toolkit updates that change them require re-approval in `/hooks`.

After these steps, `/clear`, resume, and compaction boundaries can reload Melxis guidance through the approved lifecycle hooks.

### Generic MCP

Any MCP-capable client (Claude Desktop, ChatGPT, Cursor, VS Code, Cline, etc.) can connect to the hosted MCP endpoint directly:

```
https://mcp.melxis.com
```

OAuth authentication starts automatically on the first tool call. No client-side files required.

Generic MCP clients receive Melxis MCP instructions for model-controlled recall, but they do not run local lifecycle hooks.

## Quick Start

### 1. Install

Choose your platform from the table above.

### 2. Authenticate

When you first use a Melxis tool, you'll be prompted to authenticate via OAuth. Follow the browser flow to authorize your agent. On Codex CLI, log in once with `codex mcp login melxis` before starting a session — Codex does not auto-prompt for HTTP MCP servers.

### 3. Verify setup

Start a fresh agent session and ask it to check Melxis memory, for example:

```text
Search my Melxis hives for project orientation.
```

If the agent can call `hive_search`, `mel_search`, or `task_search` after OAuth, the MCP connection is working. If anything fails, see [Troubleshooting](#troubleshooting).

That's it. Depending on the client surface, Melxis can guide the agent to:

- **Restore context** from previous sessions via plugin hooks or model-controlled Melxis searches
- **Check existing knowledge** before implementing changes
- **Save design decisions** and learnings as they come up
- **Track tasks** and hand off unfinished work across sessions

## Updating

For github-referenced installs, Claude Code requires refreshing the marketplace cache before the new version is visible.

| Platform | Update |
|----------|--------|
| Claude Code | `/plugin marketplace update melxis-com-toolkit` then `/plugin install melxis@melxis-com-toolkit` (re-install pulls the new version) |
| Codex CLI | `codex plugin marketplace upgrade melxis-com-toolkit` (re-fetches the marketplace cache) |
| Generic MCP | Server-side changes apply automatically; restart the MCP connection to refresh tool descriptions and MCP instructions |

## What's Included

Different install surfaces provide different levels of automation:

| Surface | MCP tools | Skills / rules | Lifecycle hooks |
|---------|-----------|----------------|-----------------|
| Claude Code plugin | Yes | Yes | Yes |
| Codex CLI | Yes | Skills + Hooks | Yes (`plugin_hooks`) |
| Generic MCP | Yes | MCP `instructions` | No |

MCP-only installs can search, create, update, link, and delete mels/tasks. They rely on MCP instructions and the model's use of atomic Melxis searches for recall; they do not run local lifecycle hooks.

## Skills

This toolkit includes two skills:

- **[melxis-memory](skills/memory/SKILL.md)** — Save decisions, learnings, and context into a growing knowledge graph
- **[melxis-task](skills/task/SKILL.md)** — Track work plans and coordinate tasks across sessions

## Hooks

On Claude Code and Codex CLI, the toolkit ships hooks that surface Melxis at the right moments:

| Hook | When it fires | What it does |
|------|--------------|--------------|
| SessionStart | startup / resume / post-compaction | Prompts the agent to recover context with `mel_search(tags=["project-orientation"])`, `hive_search(query="<inferred project name>")`, scoped orientation lookup when needed, and `task_search(sort="recency")` after hive resolution; also injects the active **Write policy** block |
| Stop | end of each assistant response | Silent non-blocking safety check; routine checkpoint recovery is handled on the next prompt or session boundary |
| TaskCompleted | a task is marked completed | Prompts learning extraction, task granularity audit, and link proposals |
| PreCompact | before context compaction | Captures session state before compaction |

Hook scripts emit prompts only — they do not call `mcp.melxis.com` directly. Authentication continues to flow through the standard MCP OAuth connection. Codex CLI uses the same `hooks/hooks.json` format and provides `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` env vars for OOTB compatibility, so the same hook scripts run on both platforms unchanged (gated behind the under-development `plugin_hooks` feature — see Install).

### Hook runtime (Node.js)

Hook scripts run on Node.js. The bundled `run-hook.sh` wrapper locates a runtime automatically — PATH first, then common version-manager shims (volta / asdf / mise / nodenv / fnm / nvm) and standard install locations — so hooks keep working even when the host invokes them with a minimal PATH (Codex does). If no runtime is found, hooks are skipped quietly with a one-line stderr notice instead of erroring. Set `MELXIS_NODE=/path/to/node` to point at a specific runtime.

### Write policy (`MELXIS_WRITE_POLICY`)

The default behaviour for write tools (`mel_create` / `mel_update` / `mel_patch` / `mel_link_create` / `mel_delete` / `mel_link_delete` / `task_create` / `task_update` / `task_delete`) is **auto-save**: the agent calls write tools directly when the judgement criteria (Recurrence likelihood × Inferability gap) are met, without asking for per-write confirmation. Editorial control belongs to the user at recall time — review, patch, supersede, unlink, or delete memories through MCP tools or the web UI.

Override behaviour depends on the client surface:

- **Claude Code:** set `MELXIS_WRITE_POLICY`; the SessionStart hook reads it on every session boundary.
- **Codex CLI:** enable `plugin_hooks`; the SessionStart hook reads `MELXIS_WRITE_POLICY` on every session boundary. You can also add an explicit Codex instruction such as "Use Melxis write policy: confirm" in your project or user instructions.
- **Generic MCP clients:** make the desired write policy part of the agent context using your client's instruction-loading mechanism.

`AGENTS.md` is included as a Codex project-instruction template. Codex reads it when it is placed where Codex project instructions are loaded; the copy inside an installed plugin is not a write-policy override by itself.

Routine Melxis bookkeeping stays silent; see [AGENTS.md](AGENTS.md#routine-melxis-bookkeeping) for the shared rule. MCP availability, authentication, token, and connection failures should still be reported so the user can reconnect and retry.

| Value | Behaviour |
|-------|-----------|
| `auto` (default) | Agent saves directly when judgement criteria are met. No per-write confirmation. |
| `smart` | Agent saves directly when both Recurrence and Inferability are clearly met; asks once on borderline cases. |
| `confirm` | Agent always states target/intent and waits for explicit "yes" before any write. |

For Claude Code, set in your shell profile, direnv, or launch environment:

```sh
export MELXIS_WRITE_POLICY=confirm
```

Deletion follows the active policy — there is no special carve-out. Note that `mel_delete` / `task_delete` are currently hard delete with no recovery; Graphiti-aligned soft / bi-temporal invalidation is planned mid-term work.

## Trust & Control

Melxis connects through OAuth-secured MCP and gives you control over when agents write memory.

- **OAuth-secured connection.** The hosted MCP server uses the standard MCP OAuth flow. Your agent accesses Melxis only through authorized MCP tool calls.
- **Inspectable plugin.** The Claude Code plugin is plain text / Node ESM. Hook entrypoints are in [`scripts/`](scripts/) and hook registration is in [`hooks/hooks.json`](hooks/hooks.json).
- **Prompt-only local hooks.** Claude Code hooks add guidance to the agent at session boundaries; they do not make direct network calls to Melxis or third parties.
- **Configurable writes.** Set `MELXIS_WRITE_POLICY=confirm` for Claude Code, or add an explicit write-policy instruction for Codex. Use `confirm` to require explicit confirmation before every write, or `smart` to ask on borderline cases.
- **Review and correction.** Use MCP tools or the web UI to patch, supersede, unlink, or delete stored mels and tasks.

The production service runs on Google Cloud with primary infrastructure in `asia-northeast1` (Tokyo). See the [Privacy Policy](https://melxis.com/legal/privacy) and [Terms of Service](https://melxis.com/legal/terms) for data handling, subprocessors, retention, and legal requests. For security concerns or account-level access/export/deletion requests, contact `privacy@melxis.com`.

For implementation-level details, see [SECURITY.md](SECURITY.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Melxis tools do not appear | Restart the client session and confirm the platform-specific install step loaded the MCP config (Codex: check `/plugins`). |
| Authentication, token, or connection errors | Reconnect or sign in to Melxis MCP again, then retry. On Codex CLI, run `codex mcp login melxis`. |
| Context is not restored after `/clear` / resume (Codex) | Check `/plugins` and `/hooks` — plugin hooks stay blocked until approved, and approval is tied to the hook definitions, so updates that change them require re-approval. |
| Hooks do nothing, with a one-line `Node.js not found` notice on stderr | The hook runtime could not be located. Install Node.js, or set `MELXIS_NODE=/path/to/node` (see [Hook runtime](#hook-runtime-nodejs)). |

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
Attribution: see [NOTICE](NOTICE).
"Melxis" trademark policy: see [TRADEMARK.md](TRADEMARK.md).
