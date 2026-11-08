# Behavioral evaluation

Run the installed Claude CLI with the source plugin and mock MCP world:

```sh
claude plugin eval . --runs 3 --ablation with-without --judge-model opus --no-publish
node evals/gate.mjs
```

Use opus as the judge. On 2026-11-08 the sonnet judge failed answers that met their rubric — note-routing, decision-premise-changed and decision-premise-unchanged, unanimously in some runs — while opus passed the same answers 3/3 and still failed v0.8.2's unconditional childcare promise in ordinary-shared-evidence and shared-only-ordinary 6/6. Pass `--json <path>` to keep each verdict's reasoning; the aggregate result holds only the votes.

The deterministic gate checks tool boundaries. Inspect each LLM rubric and actual answer separately: a passing tool check does not prove that knowledge was applied. Workshop cases require the final invitation to use shared evidence, conditional task-free behavior, and direct standing-guide capture. The correction case requires an actual separate Agent call, a topic-only delegation, retrieval of the newly saved own correction, and an evidence-grounded recommendation. A simulated handoff, same-agent reread, or unavailable child Agent/mock state fails that rubric. Mock writes are local to a run and never contact production.

Claude 2.1.285 exposes plugin and with/without ablation profiles, but no explicit bare MCP or hookless profile in `claude plugin eval --help`. The mock tool schema does not deliver the deployed MCP server instructions to the client. Therefore this suite does not verify the bare-MCP baseline, independent future client/session recovery, real account OAuth, OpenAI clients, or Dots activation. Those require real supported client runs and remain pending. Do not equate an Agent child that can read a mock with an independently installed client.

## Grader input evidence

Claude 2.1.285's installed eval schema supports `focus: trace` and `focus: mock_calls`. The correction save rubric uses actual mocked write inputs; the separate Agent rubric uses trace rather than the default last_message. Its strict evidence requirement is unchanged. The official LLM trace focus elides middle messages when there are more than 24, retaining the first and last 12; long textual focus inputs are also bounded. A child retrieval omitted from that judge input remains an evidence limit and cannot earn a pass from an unsupported inference. Preserve raw traces with `--keep-temp` for later diagnosis. Changing focus does not regrade or overturn the original failed runs, and no independent future-session/client recovery is proved by a child Agent.

## Required acceptance evidence

The gate requires ordinary-shared-evidence (reads-own-guide, applies-own-guide, uses-shared-evidence), shared-only-ordinary (applies-evidence), direct-guide-capture (records-practice), and note-routing (one-event-one-sentence), each in at least three with-plugin runs. Every required semantic grade must pass in every run, including mock_calls grades marked scored:false by with/without ablation. Missing cases, with arms, runs, grader definitions or grades, skipped paid graders, errors and mock guard abortions fail. A majority is insufficient for these required checks. Other deterministic boundary checks retain their existing policy.

Workshop case-local fixed hive_search responders use the real array shape and include an unrelated owned Checkout alongside the owned Workshop and shared Workshop. Guarded initial own context/guide responders return the real carrier; guide writes remain on the stateful agent responder and must preserve unrelated guide lines. The ordinary case adds a procedural rule only to its own guide fixture and checks both reading the exact own hive and applying that procedure. Shared-only lookup returns only shared rows. Saved-correction-next-agent retains genuine stateful writes and the separate Agent lane.

Run focused confirmation with the pinned installed CLI, one case at a time because --case accepts one glob:

```sh
/Users/rabe/.local/share/claude/versions/2.1.285 plugin eval . --case ordinary-shared-evidence --runs 3 --ablation none --judge-model opus --threshold 1 --no-publish --trust-plugin --keep-temp --output-dir <new-local-output>/ordinary-shared-evidence
/Users/rabe/.local/share/claude/versions/2.1.285 plugin eval . --case direct-guide-capture --runs 3 --ablation none --judge-model opus --threshold 1 --no-publish --trust-plugin --keep-temp --output-dir <new-local-output>/direct-guide-capture
/Users/rabe/.local/share/claude/versions/2.1.285 plugin eval . --case note-routing --runs 3 --ablation none --judge-model opus --threshold 1 --no-publish --trust-plugin --keep-temp --output-dir <new-local-output>/note-routing
```

Use --trust-plugin only for a directory already authorized as trusted. Keep default record mocks; do not enable real servers. A gate over an individual focused case fails for missing required cases; use the full cohort for final gating. Preserve aggregate JSON, traces and mock call logs. Inspect exact guide read input/carrier, successful guide write arguments and preserved source lines, two separate task_note payloads on the same task, and shared full-body retrieval before the answer. This is a new fixture/focus evaluation, not a regrade of prior results or proof of storage in a real service.

The note kind regex examines the current task_note input, using the installed newline-separated JSON mock_calls representation. Blocker text inside an escaped historical task_get output or note content is data and cannot count as a new blocker write. A current task_note kind=blocker still fails, including mixed call sequences and escaped content before the kind field. Checkout world IDs are complete stable UUIDs rather than display abbreviations.

The note rubric uses trace so current task_note arguments, successful results and ongoing-work rationale remain together; mock_calls alone omits that rationale. The installed trace focus keeps the first and last 12 rows when there are more than 24 rows, and text focus is bounded at 100,000 characters with an 80,000-character head and 20,000-character tail. Check the actual judge evidence against the raw trace in every required run: critical write payloads, successful results or rationale missing or elided means acceptance fails even if the judge votes PASS. Preserve original FAIL artifacts; this focus change is a new evidence variant and never a regrade.
