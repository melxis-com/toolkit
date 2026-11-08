# Melxis Toolkit

[![Melxis — One mind. Many AIs. Collective intelligence for AI.](assets/hero.png)](https://melxis.com)

What you tell one AI becomes context for another AI and your team — the next agent picks up where the last one left off.

[Melxis](https://melxis.com) keeps that context in **hives** — namespaces you can keep private or share with your team. Shared hives are read-only for everyone you invite: their agents recall your team's knowledge alongside their own, and build on it by forking mels into their own hives. A hive holds three kinds of memory:

- **mels** are facts — design decisions, bug analyses, and learnings, with the reasoning behind them
- **tasks** are history — multi-step work, what is done and what is left, private to each account
- the **guide** is how — what belongs in this hive, where each kind of thing goes, and how to work in it

Mels and tasks feed each other: tasks reference related mels for context, and completed tasks can return reusable insights to memory. For ordinary work, an agent can apply relevant knowledge from your own and shared hives without creating a task for every request. For example, a saved team writing convention can shape the next announcement, and your correction can refine the saved knowledge in the same conversation.

The guide is one short document per own hive: inside that hive it takes precedence over an agent's default habits, while what you say in the moment always comes first. Tell the agent a lasting practice — "always run the checks before committing here", "never touch production from this project", "designs go here, incident write-ups go in the ops hive" — and later agents can recall it and follow it. Shared hives expose read-only mels, not their owners' guides or tasks. These flows depend on the client making guidance available and the model using it; installation alone does not guarantee recall, saving, or every-session activation.

## Supported Platforms

Install the ordinary repository package by direct GitHub reference using the instructions below. A separate [OpenAI submission package](openai/README.md) can be built and validated locally; generating that ZIP does not publish a directory listing.

For other AI clients, see the [Connect](https://melxis.com/#connect) section on melxis.com.

### Claude Code

In the Claude Code TUI, add the marketplace and install the plugin:

```
/plugin marketplace add melxis-com/toolkit
/plugin install melxis@melxis-com-toolkit
```

Melxis is also listed in Anthropic's plugin directory (`claude plugin install melxis@anthropic-plugin-directory`). The directory carries the release that passed Anthropic's review, while this repository's marketplace gets new versions first. Install one or the other: both are named `melxis`, so only one of them loads.

### Codex CLI

1. **Add the marketplace** (in your shell):

   ```sh
   codex plugin marketplace add melxis-com/toolkit
   ```

2. **Enable the plugin** — in the Codex TUI, open `/plugins` and turn **Melxis** on.

3. **Approve the bundled hooks** — in the Codex TUI, open `/hooks` and approve `SessionStart`, `Stop`, and `TaskCompleted`. Codex blocks plugin hooks from running until you approve them once. Approval is tied to the hook definitions, so toolkit updates that change them require re-approval in `/hooks`.

After these steps, `/clear`, resume, and compaction boundaries can reload Melxis guidance through the approved lifecycle hooks.

### Generic MCP

Any MCP-capable client (Claude Desktop, ChatGPT, Cursor, VS Code, Cline, etc.) can connect to the hosted MCP endpoint directly:

```
https://mcp.melxis.com
```

Authentication follows the client's MCP OAuth flow. No client-side Melxis files are required. On Codex CLI, sign in with `codex mcp login melxis`.

Generic MCP clients receive Melxis MCP instructions for model-controlled recall, but they do not run local lifecycle hooks.

## Quick Start

### 1. Install

Choose your platform from the instructions above.

### 2. Authenticate

Connect or sign in to Melxis in your client's plugin or MCP settings and complete its OAuth flow. On Codex CLI, use `codex mcp login melxis` before starting a session. Installing a package does not itself verify authentication.

### 3. Verify setup

Start a fresh agent session and ask it to check Melxis memory, for example:

```text
Verify my Melxis connection and find the hive for this project's work.
```

The `melxis-setup` skill verifies the connection with read-only calls. It identifies an own hive by id and `own`, then reads its guide and relevant knowledge; shared-only use reads accessible mels. Task recovery is conditional on continuing tracked work. Report the calls that actually succeeded. If anything fails, see [Troubleshooting](#troubleshooting).

That's it. Depending on the client surface, Melxis can guide the agent to:

- **Restore context** from previous sessions via plugin hooks or model-controlled Melxis searches
- **Check existing knowledge** before implementing changes
- **Save design decisions** and learnings as they come up
- **Track tasks** and hand off unfinished work across sessions
- **Follow the guide you set for a hive** — say once what belongs there and how you want work done, and later sessions read it back before they start

## Updating

Claude Code caches the marketplace, so a new version only becomes visible after you refresh it.

| Platform | Update |
|----------|--------|
| Claude Code | `/plugin marketplace update melxis-com-toolkit` then `/plugin install melxis@melxis-com-toolkit` (re-install pulls the new version) |
| Codex CLI | `codex plugin marketplace upgrade melxis-com-toolkit` (re-fetches the marketplace cache) |
| Generic MCP | Server-side changes apply automatically; restart the MCP connection to refresh tool descriptions and MCP instructions |

## What's Included

Different install surfaces provide different levels of automation:

| Surface | MCP tools | Bundled guidance | Lifecycle hooks |
|---------|-----------|------------------|-----------------|
| Claude Code plugin | Yes | Skills | Yes |
| Codex CLI repository package | Yes | Skills; optional `AGENTS.md` project template | Yes |
| Locally generated OpenAI submission ZIP | Declared endpoint | Three skills | No |
| Generic MCP | Yes | MCP `instructions` | No |

MCP-only installs can search, create, update, link, and delete mels/tasks, and read and write a hive's guide. They rely on MCP instructions and the model's use of atomic Melxis searches for recall; they do not run local lifecycle hooks.

A hive's **guide** is not part of this table — it lives in Melxis, not in the install, so it reaches every surface above and follows you between clients.

## Skills

This toolkit exposes three skills:

- **[melxis-setup](skills/setup/SKILL.md)** — Verify the connection and find the scope for your work
- **[melxis-memory](skills/memory/SKILL.md)** — Apply relevant own/shared knowledge, recall reasoning, capture or refine mels, and maintain your own guide
- **[melxis-task](skills/task/SKILL.md)** — Continue tracked work, preserve progress and timelines, and extract reusable lessons when work closes

Each skill is self-contained. The bare MCP path carries its own server guidance and does not require any local file. Setup is an explicit connection workflow, not an every-session hook; in clients without hooks it offers the user one line for their custom instructions so the hive is read before work begins. Skill descriptions and MCP guidance encourage relevant use; real-client activation and successful knowledge application must be tested separately.

## Hooks

On Claude Code and Codex CLI, the toolkit ships hooks that surface Melxis at the right moments:

| Hook | When it fires | What it does |
|------|--------------|--------------|
| SessionStart | startup / resume / post-compaction | Prompts the agent to recover context: `hive_search` to resolve the project's hive set (own anchor + shared read-only), then `hive_context_get` to read that hive's guide, the mels it points at and its recent activity (the 10 most recently touched tasks) in one call; `task_get` when continuing tracked work. Injects the active **Write policy** block |
| Stop | end of each assistant response | Silent non-blocking safety check; routine checkpoint recovery is handled on the next prompt or session boundary |
| TaskCompleted | a task is marked completed | Prompts learning extraction, task granularity audit, and link proposals |
| PreCompact | before context compaction | Captures session state before compaction |

Hook scripts emit prompts only — they do not call `mcp.melxis.com` directly. Authentication continues to flow through the standard MCP OAuth connection. Codex CLI uses the same `hooks/hooks.json` format and provides `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` env vars for OOTB compatibility, so the same hook scripts run on both platforms unchanged. Codex runs them once you approve them in `/hooks` — see Install.

### Hook runtime (Node.js)

Hook scripts run on Node.js. The bundled `run-hook.sh` wrapper locates a runtime automatically — PATH first, then common version-manager shims (volta / asdf / mise / nodenv / fnm / nvm) and standard install locations — so hooks keep working even when the host invokes them with a minimal PATH (Codex does). If no runtime is found, hooks are skipped quietly with a one-line stderr notice instead of erroring. Set `MELXIS_NODE=/path/to/node` to point at a specific runtime.

### Headless `codex exec` runs

The hooks load from `~/.codex/config.toml`, so a non-interactive `codex exec` invocation can inherit them like an interactive session. They prompt context recovery and conditional work tracking. A one-shot subprocess that another tool spawns and parses, such as an independent reviewer or a schema-constrained extractor, may need an isolated configuration so that inherited MCP connections and hook guidance do not affect its result.

For those hermetic runs, pass `--ignore-user-config`:

```sh
codex exec --ignore-user-config -s read-only "<prompt>"
```

This skips `config.toml` entirely — Melxis hooks, MCP, and any other plugins do not load — while authentication still resolves from `CODEX_HOME`, so the subscription is unaffected. Use it whenever a `codex exec` reviewer/automation should run clean rather than anchored to the caller's cross-session memory. (Only keep user config when the run genuinely depends on it, e.g. a custom model provider defined there.)

### Write policy (`MELXIS_WRITE_POLICY`)

The default behaviour for write tools (`mel_create` / `mel_update` / `mel_patch` / `mel_link_create` / `mel_delete` / `mel_link_delete` / `task_create` / `task_update` / `task_delete`) is **auto-save**: the agent calls write tools directly when the judgement criteria (Recurrence likelihood × Inferability gap) are met, without asking for per-write confirmation. Editorial control belongs to the user at recall time — review, patch, supersede, unlink, or delete memories through MCP tools or the web UI.

Override behaviour depends on the client surface:

- **Claude Code:** set `MELXIS_WRITE_POLICY`; the SessionStart hook reads it on every session boundary.
- **Codex CLI:** the SessionStart hook reads `MELXIS_WRITE_POLICY` on every session boundary. You can also add an explicit Codex instruction such as "Use Melxis write policy: confirm" in your project or user instructions.
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
- **The guide comes from you, not from what an agent read.** The toolkit instructs agents to write guide lines only from what you tell them directly. Text an agent merely reads — a document, a web page, another tool's output — stays data, however imperative it sounds, so a stray "always do X" inside some file is something to raise with you rather than record. Under the default `auto` write policy the agent still calls `guide_edit` / `guide_patch` on its own judgement; set `MELXIS_WRITE_POLICY=confirm` to be asked before every guide write. The guide exists only in hives you own; a shared hive never hands you its owner's guide.
- **Review and correction.** Use MCP tools or the web UI to patch, supersede, unlink, or delete stored mels and tasks. Guide edits are recorded per hive, and recent changes can be reviewed and rolled back from the web UI.

The production service runs on Google Cloud with primary infrastructure in `asia-northeast1` (Tokyo). See the [Privacy Policy](https://melxis.com/legal/privacy) and [Terms of Service](https://melxis.com/legal/terms) for data handling, subprocessors, retention, and legal requests. For security concerns or account-level access/export/deletion requests, contact `privacy@melxis.com`.

For implementation-level details, see [SECURITY.md](SECURITY.md).

## Evaluating the Plugin

The tests under [`scripts/lib/`](scripts/lib/) check that the wording is present. They cannot tell you whether an agent that reads it behaves any differently. [`evals/`](evals/) answers that: it runs a real agent against a mocked Melxis server and scores what it does, once with the plugin and once without, so the number that matters is the difference between the two.

```bash
claude plugin eval . --runs 3 --ablation with-without --judge-model sonnet --no-publish
node evals/gate.mjs
```

Each case is a prompt plus graders; [`evals/mocks/melxis/`](evals/mocks/melxis/) stands in for the server, so no account and no real data are involved. A single run is noisy, which is why `--runs 3` is the floor.

`gate.mjs` reads the newest run and decides on the deterministic graders alone — tool calls, ordering, pattern matches, file checks, plus whether a run errored or tripped a mock guard. Each check is judged across the runs of its case: failing in most of them fails the release, failing in a minority is reported as flaky and does not. The LLM rubrics are there to be read in the HTML report, not to pass or fail a release: they are judged by a model and vary between runs. The corollary is that a green gate can sit alongside a red rubric, so open the report rather than reading the exit code alone.

All cases share one fake world, in [`evals/mocks/melxis/_server.md`](evals/mocks/melxis/_server.md), and the rubrics are written against it. Editing a fact there can leave a rubric elsewhere asserting something the world no longer says, which surfaces as that case failing for a reason unrelated to the plugin — so after touching the world, run the whole suite rather than the case you were working on.

Mocks stand in for tools but not for the server's `instructions`, so this suite exercises the installed plugin and mock tool descriptions. It cannot verify the live bare MCP baseline, OAuth, or client-specific activation. Cases that inspect answer content or saved feedback can provide behavioral evidence when a real agent run is completed; the presence of those cases or a static wording check does not demonstrate that behavior. A green gate covers only the tested cases. See [OpenAI package validation and pending checks](openai/README.md#validation-and-pending-checks) for the separate artifact and real-client boundaries.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Plugin install fails with `Permission denied (publickey)` (Claude Code) | Run `/plugin marketplace update melxis-com-toolkit`, then `/plugin install melxis@melxis-com-toolkit` — a cached entry can still resolve the plugin to an SSH clone. |
| Plugin install still fails with `Permission denied (publickey)` after a marketplace refresh, and you have no SSH key on GitHub (Claude Code) | Set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`. It switches every plugin Claude Code installs to HTTPS, not only this one, so re-check any plugin you install from a private repository over SSH. |
| Melxis tools do not appear | Restart the client session and confirm the platform-specific install step loaded the MCP config (Codex: check `/plugins`). |
| Authentication, token, or connection errors | Reconnect or sign in to Melxis MCP again, then retry. On Codex CLI, run `codex mcp login melxis`. |
| Context is not restored after `/clear` / resume (Codex) | Check `/plugins` and `/hooks` — plugin hooks stay blocked until approved, and approval is tied to the hook definitions, so updates that change them require re-approval. |
| Hooks do nothing, with a one-line `Node.js not found` notice on stderr | The hook runtime could not be located. Install Node.js, or set `MELXIS_NODE=/path/to/node` (see [Hook runtime](#hook-runtime-nodejs)). |

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
Attribution: see [NOTICE](NOTICE).
"Melxis" trademark policy: see [TRADEMARK.md](TRADEMARK.md).
