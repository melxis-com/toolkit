import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// run-hook.sh resolves a working Node runtime for hook scripts. These tests
// drive the real shell script with controlled HOME / PATH so the resolution
// branches verified during the Codex minimal-PATH incident stay verified.
// Windows-only candidate paths cannot be exercised here (no Windows CI);
// they are existence-checked + probed, so a miss degrades gracefully.

const here = dirname(fileURLToPath(import.meta.url));
const WRAPPER = join(here, '..', 'run-hook.sh');
const REAL_NODE = process.execPath;
const REAL_NODE_DIR = dirname(REAL_NODE);

// Fixture hook: proves which runtime ran it and that stdin survived intact.
function makeFixture(dir) {
  const fixture = join(dir, 'fixture-hook.mjs');
  writeFileSync(
    fixture,
    `let body = '';
process.stdin.on('data', (c) => (body += c));
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ exec: process.execPath, stdin: body }));
});
`,
  );
  return fixture;
}

function runWrapper({ fixture, env, input = '{"probe":"x"}' }) {
  const result = spawnSync('/bin/sh', [WRAPPER, fixture], {
    env,
    input,
    encoding: 'utf8',
  });
  return result;
}

function emptyHome() {
  return mkdtempSync(join(tmpdir(), 'melxis-runhook-home-'));
}

test('run-hook: resolves node from PATH and passes stdin through', () => {
  const dir = mkdtempSync(join(tmpdir(), 'melxis-runhook-'));
  const fixture = makeFixture(dir);
  const result = runWrapper({
    fixture,
    env: { HOME: emptyHome(), PATH: `${REAL_NODE_DIR}:/usr/bin:/bin` },
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.stdin, '{"probe":"x"}');
});

test('run-hook: MELXIS_NODE override wins even with empty PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'melxis-runhook-'));
  const fixture = makeFixture(dir);
  const result = runWrapper({
    fixture,
    env: { HOME: emptyHome(), PATH: '/usr/bin:/bin', MELXIS_NODE: REAL_NODE },
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.exec, REAL_NODE);
});

test('run-hook: broken shim earlier in PATH is probed and skipped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'melxis-runhook-'));
  const fixture = makeFixture(dir);
  const shimDir = join(dir, 'broken-shims');
  spawnSync('mkdir', ['-p', shimDir]);
  const shim = join(shimDir, 'node');
  writeFileSync(shim, '#!/bin/sh\nexit 1\n');
  chmodSync(shim, 0o755);
  const result = runWrapper({
    fixture,
    env: { HOME: emptyHome(), PATH: `${shimDir}:${REAL_NODE_DIR}:/usr/bin:/bin` },
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.notEqual(out.exec, shim);
});

test('run-hook: a stdin-eating broken shim cannot starve the real hook of its JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'melxis-runhook-'));
  const fixture = makeFixture(dir);
  const shimDir = join(dir, 'eater-shims');
  spawnSync('mkdir', ['-p', shimDir]);
  const shim = join(shimDir, 'node');
  writeFileSync(shim, '#!/bin/sh\ncat >/dev/null\nexit 1\n');
  chmodSync(shim, 0o755);
  const result = runWrapper({
    fixture,
    env: { HOME: emptyHome(), PATH: `${shimDir}:${REAL_NODE_DIR}:/usr/bin:/bin` },
    input: '{"prompt":"survives probing"}',
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.stdin, '{"prompt":"survives probing"}');
});

test('run-hook: fnm multishell paths on PATH are ignored (session-scoped symlinks)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'melxis-runhook-'));
  const fixture = makeFixture(dir);
  // A *working* runtime whose path matches the fnm multishell pattern must
  // still be rejected — it can vanish when the originating shell exits.
  const multiDir = join(dir, 'fnm_multishells', '12345', 'bin');
  spawnSync('mkdir', ['-p', multiDir]);
  const multiNode = join(multiDir, 'node');
  writeFileSync(multiNode, `#!/bin/sh\nexec "${REAL_NODE}" "$@"\n`);
  chmodSync(multiNode, 0o755);
  const result = runWrapper({
    fixture,
    env: { HOME: emptyHome(), PATH: `${multiDir}:${REAL_NODE_DIR}:/usr/bin:/bin` },
  });
  assert.equal(result.status, 0);
  const out = JSON.parse(result.stdout);
  assert.notEqual(out.exec, multiNode);
});

test('run-hook: graceful skip (stderr hint + exit 0) when no runtime exists anywhere', () => {
  // System-wide candidates (/opt/homebrew etc.) exist on dev machines, so
  // neutralize the absolute fallbacks in a copy of the script. The rewrite
  // is anchored to the candidate list — if the list changes shape this test
  // fails loudly rather than passing vacuously.
  const dir = mkdtempSync(join(tmpdir(), 'melxis-runhook-'));
  const fixture = makeFixture(dir);
  const src = readFileSync(WRAPPER, 'utf8');
  const neutralized = src
    .replaceAll('/opt/homebrew/bin/node', '/nonexistent/hb')
    .replaceAll('/usr/local/bin/node', '/nonexistent/ul')
    .replaceAll('/usr/bin/node', '/nonexistent/ub')
    .replaceAll('/home/linuxbrew/.linuxbrew/bin/node', '/nonexistent/lb')
    .replaceAll('/snap/bin/node', '/nonexistent/sn')
    .replaceAll('/c/Program Files/nodejs/node.exe', '/nonexistent/win');
  assert.notEqual(neutralized, src);
  const copy = join(dir, 'run-hook-neutralized.sh');
  writeFileSync(copy, neutralized);
  const result = spawnSync('/bin/sh', [copy, fixture], {
    env: { HOME: emptyHome(), PATH: join(dir, 'empty-path') },
    input: '{}',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Node\.js not found/);
  assert.match(result.stderr, /MELXIS_NODE/);
});

test('run-hook: missing script argument exits 0 with a hint (never a host error)', () => {
  const result = spawnSync('/bin/sh', [WRAPPER], {
    env: { HOME: emptyHome(), PATH: '/usr/bin:/bin' },
    input: '{}',
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /requires a hook script path/);
});
