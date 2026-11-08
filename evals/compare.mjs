#!/usr/bin/env node
// Compare eval runs of several toolkit targets, per value dimension.
//
// Usage:
//   node evals/compare.mjs <label>=<results dir> [<label>=<results dir> ...]
//
// Each results dir holds the aggregate-result.json of one target run over the
// same suite (see prepare-target.mjs). Prints, per dimension in
// dimensions.json, each target's mean case score and the share of runs where
// every grader passed, then every grader whose pass rate differs between
// targets. Costs nothing: it only reads results.
//
// The score is recomputed from each grader's pass and weight rather than taken
// from the run, because the CLI leaves some graders out of its score depending
// on the ablation mode; the same grader must count the same way in every
// target. A skipped grader counts as neither pass nor fail, is reported, and
// keeps its run out of "allpass". Missing cases, short runs and grades absent
// from a run are reported; compare only targets whose warnings match.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dims = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dimensions.json'), 'utf8'));
delete dims._doc;
const targets = process.argv.slice(2).map((a) => {
  const [label, dir] = a.split('=');
  return { label, run: JSON.parse(readFileSync(join(dir, 'aggregate-result.json'), 'utf8')) };
});
if (targets.length === 0) {
  console.error('usage: compare.mjs <label>=<results dir> ...');
  process.exit(2);
}

const mapped = new Set(Object.values(dims).flat());
const caseOf = (run, name) => run.cases.find((c) => c.name === name);
const withRuns = (c) => c?.arms?.with ?? [];
const fmt = (x) => (x === null ? '  -  ' : x.toFixed(2).padStart(5));
const graded = (r) => r.graders.filter((g) => !g.skipped && typeof g.passed === 'boolean');
const score = (r) => {
  if (r.error) return 0;
  const gs = graded(r);
  const w = gs.reduce((s, g) => s + (g.weight ?? 1), 0);
  return w ? gs.reduce((s, g) => s + (g.passed ? g.weight ?? 1 : 0), 0) / w : 0;
};

for (const t of targets) {
  const unmapped = t.run.cases.map((c) => c.name).filter((n) => !mapped.has(n));
  if (unmapped.length) console.log(`! ${t.label}: cases without a dimension: ${unmapped.join(', ')}`);
  const missing = [...mapped].filter((n) => withRuns(caseOf(t.run, n)).length === 0);
  if (missing.length) console.log(`! ${t.label}: no runs for: ${missing.join(', ')}`);
  const most = Math.max(...t.run.cases.map((c) => withRuns(c).length));
  const short = t.run.cases.filter((c) => withRuns(c).length < most).map((c) => c.name);
  if (short.length) console.log(`! ${t.label}: fewer than ${most} runs: ${short.join(', ')}`);
  const skipped = t.run.cases.flatMap((c) => withRuns(c).flatMap((r) => r.graders.filter((g) => g.skipped).map((g) => `${c.name}/${g.name}`)));
  if (skipped.length) console.log(`! ${t.label}: skipped grades: ${[...new Set(skipped)].join(', ')}`);
  const absent = t.run.cases.flatMap((c) => withRuns(c).flatMap((r) => (c.graders ?? []).map((d) => d.name).filter((n) => !r.graders.some((g) => g.name === n)).map((n) => `${c.name}/${n}`)));
  if (absent.length) console.log(`! ${t.label}: grades missing from runs: ${[...new Set(absent)].join(', ')}`);
}

console.log(`\n${'dimension'.padEnd(26)}${targets.map((t) => t.label.padStart(18)).join('')}`);
console.log(`${''.padEnd(26)}${targets.map(() => '  score / allpass'.padStart(18)).join('')}`);
for (const [dim, names] of Object.entries(dims)) {
  const cells = targets.map((t) => {
    const runs = names.flatMap((n) => withRuns(caseOf(t.run, n)));
    if (runs.length === 0) return null;
    const mean = runs.reduce((s, r) => s + score(r), 0) / runs.length;
    const all = runs.filter((r) => !r.error && r.graders.length > 0 && r.graders.every((g) => g.passed === true && !g.skipped)).length / runs.length;
    return `${fmt(mean)} / ${fmt(all)}`;
  });
  console.log(`${dim.padEnd(26)}${cells.map((c) => (c ?? '-').padStart(18)).join('')}`);
}

console.log('\nGraders whose pass rate differs between targets (pass rate over with-plugin runs):');
const names = [...new Set(targets.flatMap((t) => t.run.cases.map((c) => c.name)))];
for (const n of names) {
  const graders = [...new Set(targets.flatMap((t) => withRuns(caseOf(t.run, n)).flatMap((r) => r.graders.map((g) => g.name))))];
  for (const g of graders) {
    const rates = targets.map((t) => {
      const rs = withRuns(caseOf(t.run, n)).map((r) => r.graders.find((x) => x.name === g)).filter((x) => x && !x.skipped && typeof x.passed === 'boolean');
      return rs.length ? rs.filter((x) => x.passed === true).length / rs.length : null;
    });
    const known = rates.filter((r) => r !== null);
    if (known.length && Math.max(...known) !== Math.min(...known)) {
      console.log(`  ${`${n}/${g}`.padEnd(60)}${rates.map((r) => fmt(r).padStart(8)).join('')}`);
    }
  }
}
const cost = targets.map((t) => `${t.label} $${(t.run.costUsd ?? 0).toFixed(2)}`).join(', ');
console.log(`\ncost: ${cost}`);
