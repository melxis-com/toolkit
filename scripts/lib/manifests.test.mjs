import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;

const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const SKIP_DIRS = new Set(['.git', 'node_modules', '.github']);

/** Every plugin.json / marketplace.json the repo actually contains. */
function findManifests(dir = ROOT) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...findManifests(join(dir, entry.name)));
    } else if (entry.name === 'plugin.json' || entry.name === 'marketplace.json') {
      out.push(relative(ROOT, join(dir, entry.name)));
    }
  }
  return out;
}

// The version lives in three manifests because three clients read three
// different files. Nothing at runtime reconciles them: a release that bumps
// two of the three ships a plugin whose advertised version disagrees with the
// one the marketplace hands out, and the mismatch is invisible until someone
// installs it. The release skill bumps all three; this test is what makes a
// missed one fail loudly instead of silently.
//
// Keep this list equal to the manifests that actually exist. A checker that
// names files the repo does not have reports "no violations" for the ones it
// cannot read, which is the failure mode this test exists to remove.
const VERSIONED = [
  { path: '.claude-plugin/plugin.json', version: (m) => m.version },
  { path: '.codex-plugin/plugin.json', version: (m) => m.version },
  { path: '.claude-plugin/marketplace.json', version: (m) => m.plugins[0].version },
  { path: '.agents/plugins/marketplace.json', version: (m) => m.plugins[0].version },
];

// A hand-written list is exactly what went stale before: the release checklist
// named two files the repo does not have and omitted .agents/plugins/
// marketplace.json, which then sat a release behind while every check reported
// agreement. Discover the manifests from disk and fail when one is not covered,
// so adding a client cannot silently escape the version check.
test('manifests: every manifest on disk is covered by the version check', () => {
  const onDisk = findManifests().sort();
  const covered = new Set(VERSIONED.map((v) => v.path));
  const uncovered = onDisk.filter((p) => !covered.has(p));

  assert.deepEqual(
    uncovered,
    [],
    `manifest(s) not covered by VERSIONED — add them or the version check silently skips them:\n${uncovered.map((p) => `  ${p}`).join('\n')}`,
  );

  // The reverse direction: a listed file that no longer exists reads as "no
  // violation" for that entry.
  const missing = VERSIONED.map((v) => v.path).filter((p) => !onDisk.includes(p));
  assert.deepEqual(missing, [], `VERSIONED lists file(s) the repo does not have: ${missing}`);
});

test('manifests: every versioned manifest agrees on one version', () => {
  const found = VERSIONED.map(({ path, version }) => ({ path, value: version(read(path)) }));

  for (const { path, value } of found) {
    assert.ok(value, `${path} carries no version`);
  }

  const distinct = new Set(found.map((f) => f.value));
  assert.equal(
    distinct.size,
    1,
    `version drift across manifests:\n${found.map((f) => `  ${f.path}: ${f.value}`).join('\n')}`,
  );
});

test('manifests: the plugin name is stable across every manifest', () => {
  // Both the released plugin and a local dogfood install declare this name,
  // and the host derives the MCP tool prefix from it — two installs sharing a
  // name collide. The marketplace entry has to agree too: renaming only there
  // ships a plugin whose marketplace id differs from the name the host reads
  // out of the installed manifest, and nothing else in the repo would notice.
  const names = [
    ['.claude-plugin/plugin.json', read('.claude-plugin/plugin.json').name],
    ['.codex-plugin/plugin.json', read('.codex-plugin/plugin.json').name],
    ['.claude-plugin/marketplace.json', read('.claude-plugin/marketplace.json').plugins[0].name],
    ['.agents/plugins/marketplace.json', read('.agents/plugins/marketplace.json').plugins[0].name],
  ];

  const distinct = new Set(names.map(([, n]) => n));
  assert.equal(
    distinct.size,
    1,
    `plugin name drift across manifests:\n${names.map(([p, n]) => `  ${p}: ${n}`).join('\n')}`,
  );
});

test('manifests: hooks reference scripts that exist, via the plugin root', () => {
  const hooks = readFileSync(join(ROOT, 'hooks/hooks.json'), 'utf8');
  const referenced = [...hooks.matchAll(/scripts\/[A-Za-z0-9_.-]+/g)].map((m) => m[0]);

  assert.ok(referenced.length > 0, 'hooks.json references no scripts');

  for (const rel of new Set(referenced)) {
    // readFileSync throws with the path in the message, which is the useful
    // failure here — a renamed script otherwise fails at hook time, silently.
    readFileSync(join(ROOT, rel), 'utf8');
  }

  // Paths must stay relocatable: the plugin is installed into a version-keyed
  // cache directory, so an absolute path baked into hooks.json points at
  // whatever tree happened to be current when it was written.
  assert.match(hooks, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.doesNotMatch(hooks, /"[^"]*\/Users\//);
});
