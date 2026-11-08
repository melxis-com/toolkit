import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageSchema } from './validate-package-schema.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILDER = join(ROOT, 'scripts/build-openai-package.mjs');
const INPUTS = [
  '.codex-plugin/plugin.json', '.mcp.json', 'openai/review.json',
  'skills/setup/SKILL.md', 'skills/memory/SKILL.md', 'skills/task/SKILL.md',
  'assets/melxis-icon.svg', 'LICENSE', 'NOTICE',
];
const CONTENTS = [
  'plugin.json', 'mcp.json', 'skills/setup/SKILL.md', 'skills/memory/SKILL.md',
  'skills/task/SKILL.md',
  'assets/melxis-icon.svg', 'LICENSE', 'NOTICE',
].sort();

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'melxis-openai-package-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source');
  for (const rel of INPUTS) {
    mkdirSync(dirname(join(source, rel)), { recursive: true });
    copyFileSync(join(ROOT, rel), join(source, rel));
  }
  return { source, output: join(dir, 'package.zip'), dir };
}

function build(f) {
  return spawnSync(process.execPath, [BUILDER, '--source', f.source, '--output', f.output], { encoding: 'utf8' });
}

function json(f, rel, change) {
  const path = join(f.source, rel);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  change(value);
  writeFileSync(path, JSON.stringify(value));
}

function rejects(f, pattern) {
  const result = build(f);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, pattern);
  assert.doesNotMatch(result.stdout, /"artifact"|ready/i);
  assert.equal(existsSync(f.output), false);
}

function entry(f, rel) {
  return execFileSync('unzip', ['-p', f.output, rel], { encoding: 'utf8' });
}

test('OpenAI ZIP contains portable schemas, inline metadata and exactly three complete skills', (t) => {
  const f = fixture(t);
  const before = INPUTS.map((rel) => readFileSync(join(f.source, rel), 'utf8'));
  const result = build(f);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.artifact, f.output);
  assert.equal(report.files, CONTENTS.length);
  const paths = execFileSync('unzip', ['-Z1', f.output], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(paths, CONTENTS);
  const manifest = JSON.parse(entry(f, 'plugin.json'));
  const pluginSchema = JSON.parse(readFileSync(join(ROOT, 'scripts/lib/fixtures/agent-plugins-1.0.0-plugin.schema.json'), 'utf8'));
  validatePackageSchema(manifest, pluginSchema);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(manifest.name, 'melxis');
  assert.equal(manifest.version, JSON.parse(readFileSync(join(f.source, '.codex-plugin/plugin.json'), 'utf8')).version);
  assert.deepEqual(Object.keys(manifest).sort(), ['$schema', 'author', 'description', 'extensions', 'homepage', 'keywords', 'license', 'name', 'repository', 'version'].sort());
  const openai = manifest.extensions['com.openai'];
  assert.deepEqual(Object.keys(openai).sort(), ['interface', 'onboardingSkill', 'review']);
  assert.equal(openai.onboardingSkill, './skills/setup/SKILL.md');
  assert.deepEqual(openai.review, JSON.parse(readFileSync(join(f.source, 'openai/review.json'), 'utf8')));
  assert.deepEqual(openai.interface, JSON.parse(readFileSync(join(f.source, '.codex-plugin/plugin.json'), 'utf8')).interface);
  assert.equal(openai.review.test_cases.positive.length, 5);
  assert.equal(openai.review.test_cases.negative.length, 3);
  const mcp = JSON.parse(entry(f, 'mcp.json'));
  const mcpSchema = JSON.parse(readFileSync(join(ROOT, 'scripts/lib/fixtures/agent-plugins-1.0.0-mcp.schema.json'), 'utf8'));
  validatePackageSchema(mcp, mcpSchema);
  assert.deepEqual(mcp, {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: { melxis: { type: 'streamable-http', url: 'https://mcp.melxis.com', headers: { 'X-Melxis-Plugin': JSON.parse(readFileSync(join(f.source, '.codex-plugin/plugin.json'), 'utf8')).version } } },
  });
  for (const skill of ['setup', 'memory', 'task']) {
    const body = entry(f, `skills/${skill}/SKILL.md`);
    assert.match(body, new RegExp(`^---\\nname: melxis-${skill}\\n`));
    // each skill is self-contained: no bundled reference file to resolve
    assert.doesNotMatch(body, /\]\(\.\.\/\.\.\/references\//);
  }
  assert.deepEqual(INPUTS.map((rel) => readFileSync(join(f.source, rel), 'utf8')), before);
});

test('OpenAI ZIP excludes hooks, scripts, extra skills, credentials and unlisted local files', (t) => {
  const f = fixture(t);
  for (const rel of ['hooks/hooks.json', 'scripts/private.mjs', 'AGENTS.md', '.app.json', '.env', 'openai/credentials.json', 'skills/extra/SKILL.md']) {
    mkdirSync(dirname(join(f.source, rel)), { recursive: true });
    writeFileSync(join(f.source, rel), 'PRIVATE SENTINEL');
  }
  assert.equal(build(f).status, 0);
  assert.deepEqual(execFileSync('unzip', ['-Z1', f.output], { encoding: 'utf8' }).trim().split('\n').sort(), CONTENTS);
  assert.doesNotMatch(execFileSync('unzip', ['-p', f.output], { encoding: 'utf8' }), /PRIVATE SENTINEL/);
});

test('OpenAI ZIP rejects missing packaged onboarding skill before creating an artifact', (t) => {
  const f = fixture(t);
  rmSync(join(f.source, 'skills/setup/SKILL.md'));
  rejects(f, /missing.*skills\/setup\/SKILL\.md/i);
});

test('OpenAI ZIP rejects a dangling local Markdown reference', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'skills/memory/SKILL.md'), readFileSync(join(f.source, 'skills/memory/SKILL.md'), 'utf8') + '\n[missing](../../references/missing.md)\n');
  rejects(f, /reference.*missing/i);
});

test('OpenAI ZIP rejects references that escape the package, including encoded traversal', (t) => {
  for (const target of ['../../../outside.md', '../../%2e%2e/outside.md', '/etc/passwd', 'file:///etc/passwd']) {
    const f = fixture(t);
    writeFileSync(join(f.source, 'skills/memory/SKILL.md'), readFileSync(join(f.source, 'skills/memory/SKILL.md'), 'utf8') + `\n[escape](${target})\n`);
    rejects(f, /reference.*(escape|absolute|scheme)/i);
  }
});

test('OpenAI ZIP rejects a reference to an existing but unlisted source file', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'private.md'), 'PRIVATE SENTINEL');
  writeFileSync(join(f.source, 'skills/task/SKILL.md'), readFileSync(join(f.source, 'skills/task/SKILL.md'), 'utf8') + '\n[private](../../private.md)\n');
  rejects(f, /reference.*not packaged/i);
});

test('OpenAI ZIP rejects symlinked packaged files and symlinked ancestors', (t) => {
  for (const ancestor of [false, true]) {
    const f = fixture(t);
    if (ancestor) {
      const body = readFileSync(join(f.source, 'skills/setup/SKILL.md'));
      rmSync(join(f.source, 'skills/setup'), { recursive: true });
      mkdirSync(join(f.dir, 'external'));
      writeFileSync(join(f.dir, 'external/SKILL.md'), body);
      symlinkSync(join(f.dir, 'external'), join(f.source, 'skills/setup'));
    } else {
      const path = join(f.source, 'assets/melxis-icon.svg');
      const body = readFileSync(path);
      rmSync(path);
      writeFileSync(join(f.dir, 'external.svg'), body);
      symlinkSync(join(f.dir, 'external.svg'), path);
    }
    rejects(f, /symlink/i);
  }
});

test('OpenAI ZIP rejects malformed JSON and unsupported ordinary manifest fields', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.source, '.codex-plugin/plugin.json'), '{broken');
  rejects(f, /invalid JSON/i);
  const second = fixture(t);
  json(second, '.codex-plugin/plugin.json', (m) => { m.interface.shortDescription = 'x'.repeat(31); });
  rejects(second, /shortDescription/i);
});

test('OpenAI ZIP rejects wrong skill identity and missing skill descriptions', (t) => {
  for (const edit of [(s) => s.replace('name: melxis-setup', 'name: melxis-other'), (s) => s.replace(/^description:.*\n/m, '')]) {
    const f = fixture(t);
    const path = join(f.source, 'skills/setup/SKILL.md');
    writeFileSync(path, edit(readFileSync(path, 'utf8')));
    rejects(f, /skill.*(name|description)/i);
  }
});

test('OpenAI ZIP rejects insufficient or incomplete review cases and private reviewer fields', (t) => {
  for (const edit of [
    (r) => r.test_cases.positive.pop(),
    (r) => r.test_cases.negative.pop(),
    (r) => { r.test_cases.positive[0].expected_behavior = ''; },
    (r) => { r.test_credentials = 'PRIVATE SENTINEL'; },
    (r) => { r.reviewer_instructions = 'PRIVATE SENTINEL'; },
  ]) {
    const f = fixture(t);
    json(f, 'openai/review.json', edit);
    rejects(f, /review/i);
  }
});

test('OpenAI ZIP rejects local MCP transports, multiple servers and credential-bearing URLs', (t) => {
  for (const edit of [
    (m) => { m.mcpServers.melxis = { command: 'private-command' }; },
    (m) => { m.mcpServers.other = { type: 'http', url: 'https://example.com' }; },
    (m) => { m.mcpServers.melxis.url = 'https://user:secret@mcp.melxis.com'; },
    (m) => { m.mcpServers.melxis.url = 'https://mcp.melxis.com?token=secret'; },
  ]) {
    const f = fixture(t);
    json(f, '.mcp.json', edit);
    rejects(f, /MCP/i);
  }
});

test('OpenAI ZIP rejects unsafe icon references and secret material in included text', (t) => {
  const f = fixture(t);
  json(f, '.codex-plugin/plugin.json', (m) => { m.interface.logo = '../outside.svg'; });
  rejects(f, /asset.*(escape|path)/i);
  const secret = fixture(t);
  writeFileSync(join(secret.source, 'NOTICE'), '-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----\n');
  rejects(secret, /secret/i);
});

test('OpenAI ZIP rejects output symlinks without overwriting their targets', (t) => {
  const f = fixture(t);
  const target = join(f.dir, 'protected.txt');
  writeFileSync(target, 'KEEP');
  symlinkSync(target, f.output);
  const result = build(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink/i);
  assert.equal(readFileSync(target, 'utf8'), 'KEEP');
  assert.doesNotMatch(result.stdout, /"artifact"|ready/i);
});

test('portable schema validation rejects Codex component fields and wrong MCP transports', () => {
  const plugin = JSON.parse(readFileSync(join(ROOT, 'scripts/lib/fixtures/agent-plugins-1.0.0-plugin.schema.json'), 'utf8'));
  const mcp = JSON.parse(readFileSync(join(ROOT, 'scripts/lib/fixtures/agent-plugins-1.0.0-mcp.schema.json'), 'utf8'));
  assert.throws(() => validatePackageSchema({ $schema: plugin.$id, name: 'melxis', skills: './skills/' }, plugin), /unexpected property skills/);
  assert.throws(() => validatePackageSchema({ $schema: plugin.$id, name: 'melxis', author: { name: 'Melxis', token: 'private' } }, plugin), /unexpected property token/);
  assert.throws(() => validatePackageSchema({ $schema: mcp.$id, mcpServers: { melxis: { type: 'http', url: 'https://mcp.melxis.com' } } }, mcp), /matching schema branch/);
  assert.throws(() => validatePackageSchema({ $schema: mcp.$id, mcpServers: { melxis: { type: 'streamable-http', url: 'https://mcp.melxis.com', command: 'local' } } }, mcp), /matching schema branch/);
});

test('bounded schema validation fails on unsupported keywords even in unused branches', () => {
  assert.throws(() => validatePackageSchema({}, { type: 'object', properties: { unused: { format: 'uri' } } }), /unsupported schema keyword format/);
  assert.throws(() => validatePackageSchema('ok', { oneOf: [{ type: 'string' }, { type: 'number', minimum: 2 }] }), /unsupported schema keyword minimum/);
});
