#!/usr/bin/env node
// Release gate over an eval run.
//
// `claude plugin eval` scores a case by mixing deterministic graders
// (tool_used / tool_order / regex / file_exists) with llm rubrics. The rubrics
// are the interesting part to read, but they are judged by a model and vary
// run to run, so a threshold over the case score flaps. This gate reads the
// same run and decides on the deterministic graders alone: every one of them
// has to pass in the with-plugin arm.
//
// Usage:
//   node evals/gate.mjs [<results dir>]
//
// With no argument it takes the newest directory under evals/results/. Run the
// suite first; this does not spawn agents and costs nothing.
//
// Exit 0 = gate green. Exit 1 = a deterministic grader failed, or a run errored
// or was aborted by a mock guard. Exit 2 = nothing to read.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const DETERMINISTIC = new Set(['tool_used', 'tool_order', 'regex', 'file_exists', 'exit_code']);

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

// Agent behavior varies between runs, so one red run is not the same thing as
// a broken plugin. A check is judged over the runs of its case: failing in
// most of them is a failure, failing in some is flakiness, which is reported
// and does not block. With --runs 1 the two collapse, which is why the suite
// is meant to be run three times.
let checked = 0;
const flaky = [];
for (const c of run.cases ?? []) {
  // Grader type lives on the case; pass/fail lives on each run. Join by name.
  const typeOf = new Map((c.graders ?? []).map((g) => [g.name, g.type]));
  // Single-arm runs (--ablation none) key the arm differently, so take the
  // with arm when there is one and the only arm otherwise. The without arm is
  // the baseline and is meant to fail.
  const arms = c.arms ?? {};
  const runs = arms.with ?? Object.values(arms)[0] ?? [];
  const tally = new Map(); // grader name -> { passed, total, why }

  for (const r of runs) {
    if (r.error) {
      failures.push({ case: c.name, grader: '(run)', why: String(r.error).slice(0, 160) });
    }
    if (r.aborted) {
      const a = r.aborted;
      failures.push({ case: c.name, grader: '(mock guard)', why: `${a.server}/${a.tool}: ${String(a.reason).slice(0, 140)}` });
    }
    for (const g of r.graders ?? []) {
      // A grader the runner left out of the score is an indicator, not a
      // verdict: regex over mock_calls becomes one automatically, because a
      // without-plugin arm has no calls to match. The field is `scored`, and
      // reading `with_only` instead silently gates on indicators.
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
  console.log(`gate: FAIL — ${failures.length} of ${checked} deterministic checks (${label})`);
  for (const f of failures) console.log(`  ${f.case} · ${f.grader}\n    ${f.why}`);
  process.exit(1);
}

const note = flaky.length > 0 ? `, ${flaky.length} flaky` : '';
console.log(`gate: pass — ${checked} deterministic checks${note} (${label})`);
