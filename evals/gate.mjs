#!/usr/bin/env node
// Release gate over an eval run.
//
// Required semantic and mock_calls evidence must pass in each with-plugin
// run, even when excluded from with/without scoring. Other deterministic
// checks retain the existing majority policy.
// This gate does not spawn agents or replace inspection of raw payloads.
//
// Usage:
//   node evals/gate.mjs [<results dir>]
//
// With no argument it takes the newest directory under evals/results/. Run the
// suite first; this does not spawn agents and costs nothing.
//
// Exit 0 = gate green. Exit 1 = required evidence failed or is incomplete,
// a deterministic boundary failed, or a run errored/aborted. Exit 2 = nothing to read.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const DETERMINISTIC = new Set(['tool_used', 'tool_order', 'regex', 'file_exists', 'exit_code']);
const MANDATORY_SEMANTIC = new Map([
  ['ordinary-shared-evidence', ['reads-own-guide', 'applies-own-guide', 'uses-shared-evidence']],
  ['shared-only-ordinary', ['applies-evidence']],
  ['direct-guide-capture', ['records-practice']],
  ['note-routing', ['one-event-one-sentence']],
  ['saved-correction-next-agent', ['correction-is-usable']],
  ['superseded-not-applied', ['uses-current-decision']],
  ['stale-mel-checked', ['checks-against-current']],
  ['decision-premise-changed', ['revisits-on-new-premise']],
  ['decision-premise-unchanged', ['weighs-with-the-record']],
]);
const MANDATORY_MOCK_CALLS = new Map([
  ['note-routing', ['kind-used', 'lands-as-a-note']],
  ['blocked-on-external', ['kind-used']],
]);
const MIN_REQUIRED_RUNS = 3;

function newestResultsDir() {
  const root = join(EVALS_DIR, 'results');
  if (!existsSync(root)) return null;
  const runs = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  return runs.length > 0 ? join(root, runs.at(-1)) : null;
}

const dir = process.argv[2] ?? newestResultsDir();
if (dir === null) {
  console.error('gate: no run to read — run `claude plugin eval .` first');
  process.exit(2);
}

const file = join(dir, 'aggregate-result.json');
if (!existsSync(file)) {
  console.error(`gate: ${file} does not exist`);
  process.exit(2);
}

const run = JSON.parse(readFileSync(file, 'utf8'));

// A with-arm that ran without the plugin loaded grades nothing meaningful, and
// the failure is silent unless it is checked: the scores just look like the
// plugin did not help. The runner reports it per plugin as a `problem`.
const BLOCKING_PLUGIN_PROBLEMS = new Set(['manifest_invalid', 'disabled_by_default', 'will_not_load']);
const plugins = run.suite?.plugins ?? [];
const failures = [];

if (plugins.length === 0) {
  failures.push({ case: '(suite)', grader: 'plugin loaded', why: 'no plugin resolved — the with arm ran without it' });
}
for (const p of plugins) {
  if (BLOCKING_PLUGIN_PROBLEMS.has(p.problem)) {
    failures.push({ case: '(suite)', grader: 'plugin loaded', why: `${p.name}: ${p.problem}` });
  }
}

// Required evidence is complete only when every with-plugin run passes.
let checked = 0;
let semanticChecked = 0;
let indicatorChecked = 0;
const requiredCases = new Set([...MANDATORY_SEMANTIC.keys(), ...MANDATORY_MOCK_CALLS.keys()]);
for (const name of requiredCases) {
  const required = [
    ...(MANDATORY_SEMANTIC.get(name) ?? []).map((name) => ({ name, type: 'llm' })),
    ...(MANDATORY_MOCK_CALLS.get(name) ?? []).map((name) => ({ name, type: 'regex', target: 'mock_calls' })),
  ];
  const matches = (run.cases ?? []).filter((c) => c.name === name);
  if (matches.length !== 1) {
    failures.push({ case: name, grader: '(required case)', why: `expected one case, found ${matches.length}` });
    continue;
  }
  const c = matches[0];
  // The installed CLI keys even --ablation none runs as "with". Never
  // substitute a baseline arm when the with-plugin evidence is absent.
  const runs = c.arms?.with;
  if (!Array.isArray(runs) || runs.length < MIN_REQUIRED_RUNS) {
    failures.push({ case: name, grader: '(required runs)', why: `need at least ${MIN_REQUIRED_RUNS} with-plugin runs, found ${Array.isArray(runs) ? runs.length : 0}` });
  }
  for (const { name: grader, type, target } of required) {
    const definitions = (c.graders ?? []).filter((g) => g.name === grader);
    if (definitions.length !== 1 || definitions[0].type !== type || (target && definitions[0].config?.target !== target)) {
      failures.push({ case: name, grader, why: `required ${target ?? 'semantic'} grader definition missing, ambiguous or incompatible` });
    }
    for (const [index, r] of (Array.isArray(runs) ? runs : []).entries()) {
      if (target) indicatorChecked += 1;
      else semanticChecked += 1;
      const grades = (r.graders ?? []).filter((g) => g.name === grader);
      if (r.skippedPaidGraders || grades.length !== 1 || grades[0].passed !== true || grades[0].skipped === true) {
        failures.push({ case: name, grader, why: `run ${index + 1}: ${r.skippedPaidGraders ? 'paid graders skipped' : grades.length !== 1 ? 'required grade missing or ambiguous' : 'required grade failed or skipped'} · ${String(grades[0]?.explanation ?? '').slice(0, 140)}` });
      }
    }
  }
}
const flaky = [];
for (const c of run.cases ?? []) {
  // Grader type lives on the case; pass/fail lives on each run. Join by name.
  const typeOf = new Map((c.graders ?? []).map((g) => [g.name, g.type]));
  // The baseline is not acceptance evidence.
  const arms = c.arms ?? {};
  const runs = arms.with ?? [];
  const tally = new Map(); // grader name -> { passed, total, why }
  const requiredNames = new Set([...(MANDATORY_SEMANTIC.get(c.name) ?? []), ...(MANDATORY_MOCK_CALLS.get(c.name) ?? [])]);

  for (const r of runs) {
    if (r.error) {
      failures.push({ case: c.name, grader: '(run)', why: String(r.error).slice(0, 160) });
    }
    if (r.aborted) {
      const a = r.aborted;
      failures.push({ case: c.name, grader: '(mock guard)', why: `${a.server}/${a.tool}: ${String(a.reason).slice(0, 140)}` });
    }
    for (const g of r.graders ?? []) {
      // Required evidence was checked above independently of scoring.
      // Other deterministic checks keep their previous majority policy.
      if (requiredNames.has(g.name)) continue;
      if (g.scored === false) continue;
      if (!DETERMINISTIC.has(typeOf.get(g.name))) continue;
      const t = tally.get(g.name) ?? { passed: 0, total: 0, why: '' };
      t.total += 1;
      if (g.passed) t.passed += 1;
      else t.why = String(g.explanation ?? '').slice(0, 140);
      tally.set(g.name, t);
    }
  }

  for (const [name, t] of tally) {
    checked += 1;
    if (t.passed * 2 <= t.total) {
      failures.push({ case: c.name, grader: name, why: `${t.passed}/${t.total} runs · ${t.why}` });
    } else if (t.passed < t.total) {
      flaky.push({ case: c.name, grader: name, why: `${t.passed}/${t.total} runs · ${t.why}` });
    }
  }
}

if (checked === 0 && failures.length === 0) {
  console.error('gate: the run has no deterministic graders — nothing was checked');
  process.exit(2);
}

const label = dir.replace(`${EVALS_DIR}/`, '');
for (const f of flaky) {
  console.log(`  flaky  ${f.case} · ${f.grader}\n    ${f.why}`);
}

if (failures.length > 0) {
  console.log(`gate: FAIL — ${failures.length} failures across ${checked} deterministic, ${semanticChecked} required semantic and ${indicatorChecked} required mock_calls checks (${label})`);
  for (const f of failures) console.log(`  ${f.case} · ${f.grader}\n    ${f.why}`);
  process.exit(1);
}

const note = flaky.length > 0 ? `, ${flaky.length} flaky` : '';
console.log(`gate: pass — ${checked} deterministic checks${note}, ${semanticChecked} required semantic and ${indicatorChecked} required mock_calls run checks (${label})`);
