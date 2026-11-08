# OpenAI submission package

The public package carries Melxis's shared knowledge workflows: setup, memory and tasks. Relevant own and shared mels can inform ordinary work; a correction or reusable lesson can refine own memory for the next agent. Own guides steer how work is done, and tracked work preserves progress and an available timeline. Current user instructions outrank the guide; shared mels remain read-only. Recall, capture and skill activation depend on the client and model.

This directory contains review metadata and build documentation. It is not a submitted or published plugin. No demo account, domain verification, publisher verification, video, or real-client compatibility is established by these files.

## Build locally

From the toolkit repository root, with Node.js and the system `zip` and `unzip` commands available:

```sh
node --test scripts/lib/*.test.mjs
node scripts/build-openai-package.mjs
node --check scripts/build-openai-package.mjs
unzip -l dist/melxis-openai-<version>.zip
unzip -t dist/melxis-openai-<version>.zip
```

The builder returns one JSON report containing the artifact path, file count, byte size and version after validating the actual archive. Build failures return a nonzero exit and do not report an artifact as ready. The default output is ignored by Git. An existing successful artifact is replaced only after the new archive passes validation; after a failed rebuild, any old artifact must not be mistaken for a new success.

For an isolated source fixture or output destination:

```sh
node scripts/build-openai-package.mjs --source /path/to/toolkit --output /path/to/package.zip
```

The source must contain the approved inputs. The output may be outside it; outputs inside the source must be under `dist/`. Do not add credentials or private reviewer access instructions to any public input.

## Archive contents

The explicit file allowlist produces eight files at the ZIP root, without a wrapping directory:

```text
plugin.json
mcp.json
skills/setup/SKILL.md
skills/memory/SKILL.md
skills/task/SKILL.md
assets/melxis-icon.svg
LICENSE
NOTICE
```

Root `plugin.json` is derived from `.codex-plugin/plugin.json` and `openai/review.json`. It declares the portable Agent Plugins schema. Listing fields are in `extensions.com.openai.interface`; review cases are an inline object in `extensions.com.openai.review`; onboarding points to `./skills/setup/SKILL.md`. Root `mcp.json` declares its own portable schema and the existing hosted endpoint using `streamable-http`. The ordinary `.mcp.json` retains its existing `http` transport.

The archive contains exactly three discoverable skills, each self-contained. Markdown references must resolve to allowlisted files inside the archive. Local hooks, scripts, `AGENTS.md`, marketplace manifests, `apps`, `.app.json`, build/test schema fixtures and unlisted files are excluded. The package carries the version in `.codex-plugin/plugin.json`, the same as the Claude and Codex plugins.

The builder validates the actual archived manifest and MCP configuration against the [vendored official 1.0.0 schema snapshots](../scripts/lib/fixtures/agent-plugins-SOURCE.md) using a bounded dependency-free validator. OpenAI listing and review constraints are checked separately because the portable schema deliberately leaves extension contents to the client. The checks also reject missing inputs, unsupported fields, malformed skill headers, unresolved or escaping Markdown references, input symlinks, unsafe icon paths, private reviewer fields, credential-bearing URLs and recognizable secret markers. An allowlist and marker checks do not establish that arbitrary prose contains no confidential information; review the public inputs before submission.

The source contracts are documented in the official [package guide](https://developers.openai.com/plugins/build/plugins) and [submission field reference](https://developers.openai.com/plugins/deploy/submission). The public submission format currently excludes lifecycle hooks and app references. Onboarding is a setup workflow, not proof of activation in every session.

## Reviewer sample data

`review.json` defines five positive and three negative scenarios. These describe required fixtures; they have not been seeded or run against a live review account by the package build.

Prepare a dedicated reviewer account with an own **OpenAI Review** hive containing a weekly-planning decision and its rationale, a sample launch task whose draft is ready and checklist remains, and an available timeline consistent with that state. Give it access to a read-only **OpenAI Review Shared** hive containing the writing convention that examples use fictional data. Keep **Project Zircon-Review-404** absent. Use fictional content and make the stated data available for repeated review runs. The save case must reuse a matching UTC-export decision on repetition instead of creating duplicate mels.

Verify own/shared boundaries and all expected results through authenticated calls. Keep credentials and reviewer sign-in instructions outside the ZIP and enter them through the secure review dashboard when submission is authorized. The sample account must remain usable for future reviews.

## Validation and pending checks

| Evidence | What it establishes |
| --- | --- |
| Node regression tests | Tested static guidance and local logic; ZIP tests build and inspect real archives using isolated fixture copies |
| Builder success and `unzip -t` | A locally validated submission artifact with portable schemas, allowed files and resolved references |
| Completed mocked real-agent eval runs | Only the measured behavior in those reports; fixture definitions and static tests alone do not establish model behavior |
| Authenticated real-client runs | Actual connection, skill discovery/activation, reference availability and knowledge application for that tested client |

The following remain separate from local package validation:

- Dedicated reviewer login, actual sample-data preparation, and all five positive/three negative review scenarios.
- Reviewer-accessible video walkthrough, publisher identity, public support/legal URL checks, domain verification, country availability and dashboard scans.
- ChatGPT, Codex and Dots installation/discovery, onboarding and ordinary-work activation, shared-reference access, own/shared permissions, relevant knowledge in answers and correction feedback usable by a later agent. No Dots compatibility is claimed.
- Bare MCP server-instruction delivery and behavior without installed skills or hooks.
- Authenticated regional latency measured end to end; unauthenticated HTTP responses or skill count do not establish latency.
- Any push, version bump, release, submission, publication or production change, each outside this local build.

For real-client checks, record the client/version, guidance actually loaded, successful authenticated tools, response use of saved evidence, and the next agent's recovery of any saved correction. A prompt reminder, skill selection, or one tool call alone does not establish the full workflow.
