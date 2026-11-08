#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePackageSchema } from './lib/validate-package-schema.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SKILLS = ['setup', 'memory', 'task'];
const INCLUDED = [
  ...SKILLS.map((name) => `skills/${name}/SKILL.md`),
  'assets/melxis-icon.svg', 'LICENSE', 'NOTICE',
];
const INPUTS = ['.codex-plugin/plugin.json', '.mcp.json', 'openai/review.json', ...INCLUDED];
const PLUGIN_SCHEMA = JSON.parse(readFileSync(new URL('./lib/fixtures/agent-plugins-1.0.0-plugin.schema.json', import.meta.url), 'utf8'));
const MCP_SCHEMA = JSON.parse(readFileSync(new URL('./lib/fixtures/agent-plugins-1.0.0-mcp.schema.json', import.meta.url), 'utf8'));
const IDENTITY = ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'];
const INTERFACE = ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category', 'capabilities', 'defaultPrompt', 'websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL', 'brandColor', 'composerIcon', 'logo', 'screenshots'];
const REVIEW = ['test_cases', 'demo_recording_url', 'commerce', 'commerce_description'];

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
}

function keys(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unsupported field ${key}`);
}

function text(value, label, max = Infinity) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label}: expected nonempty text of at most ${max} characters`);
  }
}

function publicURL(value, label) {
  text(value, label, 2048);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}: invalid URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(`${label}: expected public HTTPS URL without credentials, query or fragment`);
  return url;
}

function parse(body, label) {
  try { return JSON.parse(body); } catch { throw new Error(`${label}: invalid JSON`); }
}

function sourceFile(root, rel) {
  let current = root;
  for (const part of rel.split('/')) {
    current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch { throw new Error(`missing source file ${rel}`); }
    if (stat.isSymbolicLink()) throw new Error(`symlink source path ${rel}`);
    if (current !== join(root, rel) && !stat.isDirectory()) throw new Error(`source path is not a directory: ${rel}`);
  }
  const stat = lstatSync(current);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error(`source file must be regular and at most 5 MiB: ${rel}`);
  const body = readFileSync(current, 'utf8');
  if (body.includes('\u0000') || body.includes('\ufffd')) throw new Error(`source file must be UTF-8 text: ${rel}`);
  return body;
}

function noSecrets(body, label) {
  // An allowlist is the main privacy boundary. Reject recognizable secrets in
  // the public inputs too; this cannot classify all confidential prose.
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\bAKIA[A-Z0-9]{16}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b|\b(?:access_token|refresh_token|client_secret|api_key)\s*[=:]\s*["']?[A-Za-z0-9_./+-]{16,}/i.test(body)) {
    throw new Error(`${label}: secret material is not allowed in the public package`);
  }
}

function assetPath(value) {
  if (typeof value !== 'string' || value !== './assets/melxis-icon.svg') throw new Error(`asset path must use the allowlisted ./assets/melxis-icon.svg: ${value}`);
}

function validateInterface(value) {
  keys(value, INTERFACE, 'interface');
  for (const [key, max] of [['displayName', 30], ['shortDescription', 30], ['longDescription', 4000], ['developerName', 80], ['category', 120]]) text(value[key], `interface.${key}`, max);
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) publicURL(value[key], `interface.${key}`);
  for (const key of ['composerIcon', 'logo']) assetPath(value[key]);
  if (!/^#[0-9a-f]{6}$/i.test(value.brandColor)) throw new Error('interface.brandColor: expected a hex color');
  for (const [key, limit] of [['capabilities', 20], ['defaultPrompt', 20]]) {
    if (!Array.isArray(value[key]) || value[key].length < 1 || value[key].length > limit) throw new Error(`interface.${key}: expected a bounded nonempty array`);
    value[key].forEach((item) => text(item, `interface.${key}`, key === 'capabilities' ? 120 : 4000));
  }
  if (!Array.isArray(value.screenshots) || value.screenshots.length !== 0) throw new Error('interface.screenshots: this package has no allowlisted screenshots');
}

function validateReview(value) {
  keys(value, REVIEW, 'review');
  keys(value.test_cases, ['positive', 'negative'], 'review.test_cases');
  for (const [kind, minimum] of [['positive', 5], ['negative', 3]]) {
    const cases = value.test_cases[kind];
    if (!Array.isArray(cases) || cases.length < minimum) throw new Error(`review.${kind}: at least ${minimum} cases required`);
    for (const [i, item] of cases.entries()) {
      const label = `review.${kind}[${i}]`;
      keys(item, ['description', 'prompt', 'tools_triggered', 'expected_behavior'], label);
      for (const key of ['description', 'prompt', 'expected_behavior']) text(item[key], `${label}.${key}`);
      if (kind === 'positive' || item.tools_triggered !== undefined) text(item.tools_triggered, `${label}.tools_triggered`);
    }
  }
  if (typeof value.commerce !== 'boolean') throw new Error('review.commerce: expected boolean');
  text(value.commerce_description, 'review.commerce_description');
  if (value.demo_recording_url !== undefined) publicURL(value.demo_recording_url, 'review.demo_recording_url');
}

function validateSkill(body, name) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)?.[1];
  if (!header) throw new Error(`skill ${name}: missing YAML header`);
  const skillName = /^name:\s*(.*?)\s*$/m.exec(header)?.[1];
  const description = /^description:\s*(.*?)\s*$/m.exec(header)?.[1];
  if (skillName !== `melxis-${name}`) throw new Error(`skill ${name}: invalid name`);
  text(description, `skill ${name} description`, 1024);
}

function localLinks(body) {
  const inline = [...body.matchAll(/\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)].map((m) => m[1]);
  const definitions = [...body.matchAll(/^\s*\[[^\]\n]+\]:\s*(<[^>]+>|\S+)/gm)].map((m) => m[1]);
  return [...inline, ...definitions];
}

function validateReferences(files) {
  for (const [rel, body] of files) {
    if (!rel.endsWith('.md')) continue;
    for (let target of localLinks(body)) {
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      try { target = decodeURIComponent(target); } catch { throw new Error(`reference in ${rel}: invalid encoding`); }
      if (/^(?:https?:|mailto:)/i.test(target) || target.startsWith('#')) continue;
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) throw new Error(`reference in ${rel}: unsupported scheme`);
      if (target.startsWith('/') || target.includes('\\') || target.includes('\u0000')) throw new Error(`reference in ${rel}: absolute or escaped path`);
      target = target.split(/[?#]/, 1)[0];
      const resolved = posix.normalize(posix.join(posix.dirname(rel), target));
      if (resolved === '..' || resolved.startsWith('../')) throw new Error(`reference in ${rel}: escapes package`);
      if (!files.has(resolved)) throw new Error(`reference in ${rel}: ${resolved} is missing or not packaged`);
    }
  }
}

function validateIcon(body) {
  // SVG is the only public asset this package needs. Numeric square viewBox
  // dimensions are sufficient for the directory's minimum 48 px icon rule.
  const box = /<svg\b[^>]*\bviewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(body);
  if (!box || Number(box[3]) < 48 || Number(box[3]) !== Number(box[4])) throw new Error('asset icon: expected square SVG viewBox of at least 48');
  if (/<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|data:)|<!ENTITY/i.test(body)) throw new Error('asset icon: executable or external SVG content is not allowed');
}

function portableInputs(inputs) {
  const source = parse(inputs.get('.codex-plugin/plugin.json'), 'source manifest');
  keys(source, [...IDENTITY, 'skills', 'mcpServers', 'interface'], 'source manifest');
  if (source.name !== 'melxis' || !/^\d+\.\d+\.\d+$/.test(source.version ?? '')) throw new Error('source manifest: preserve melxis identity and a release version');
  if (source.skills !== './skills/' || source.mcpServers !== './.mcp.json') throw new Error('source manifest: unsupported skills or MCP source mapping');
  validateInterface(source.interface);
  const review = parse(inputs.get('openai/review.json'), 'review');
  validateReview(review);
  const manifest = { $schema: PLUGIN_SCHEMA.$id };
  for (const key of IDENTITY) if (source[key] !== undefined) manifest[key] = source[key];
  manifest.extensions = { 'com.openai': {
    interface: source.interface,
    onboardingSkill: './skills/setup/SKILL.md',
    review,
  } };
  validatePackageSchema(manifest, PLUGIN_SCHEMA, 'portable plugin.json');

  const ordinary = parse(inputs.get('.mcp.json'), 'MCP source');
  keys(ordinary, ['mcpServers'], 'MCP source');
  keys(ordinary.mcpServers, ['melxis'], 'MCP source servers');
  keys(ordinary.mcpServers.melxis, ['type', 'url', 'headers'], 'MCP source melxis');
  if (ordinary.mcpServers.melxis.type !== 'http') throw new Error('MCP source: expected existing remote HTTP transport');
  const url = publicURL(ordinary.mcpServers.melxis.url, 'MCP source URL');
  if (url.href !== 'https://mcp.melxis.com/') throw new Error('MCP source: expected the existing Melxis endpoint');
  // The only header is the plugin version the server logs per request. It must
  // equal the manifest version, so the server can tell which package a call
  // came from; anything else (credentials above all) stays out of the package.
  const headers = ordinary.mcpServers.melxis.headers;
  keys(headers, ['X-Melxis-Plugin'], 'MCP source headers');
  if (headers['X-Melxis-Plugin'] !== source.version) throw new Error(`MCP source headers: X-Melxis-Plugin must equal the manifest version ${source.version}`);
  const mcp = { $schema: MCP_SCHEMA.$id, mcpServers: { melxis: { type: 'streamable-http', url: ordinary.mcpServers.melxis.url, headers: { 'X-Melxis-Plugin': headers['X-Melxis-Plugin'] } } } };
  validatePackageSchema(mcp, MCP_SCHEMA, 'portable mcp.json');
  const files = new Map(INCLUDED.map((rel) => [rel, inputs.get(rel)]));
  files.set('plugin.json', JSON.stringify(manifest, null, 2) + '\n');
  files.set('mcp.json', JSON.stringify(mcp, null, 2) + '\n');
  return files;
}

function validateFiles(files) {
  for (const [rel, body] of files) noSecrets(body, rel);
  validatePackageSchema(parse(files.get('plugin.json'), 'portable plugin.json'), PLUGIN_SCHEMA, 'portable plugin.json');
  validatePackageSchema(parse(files.get('mcp.json'), 'portable mcp.json'), MCP_SCHEMA, 'portable mcp.json');
  const extension = parse(files.get('plugin.json'), 'portable plugin.json').extensions['com.openai'];
  keys(extension, ['interface', 'review', 'onboardingSkill'], 'OpenAI extension');
  if (extension.onboardingSkill !== './skills/setup/SKILL.md' || !files.has(extension.onboardingSkill.slice(2))) throw new Error('missing packaged onboarding skill');
  validateInterface(extension.interface);
  validateReview(extension.review);
  for (const name of SKILLS) validateSkill(files.get(`skills/${name}/SKILL.md`), name);
  validateIcon(files.get('assets/melxis-icon.svg'));
  validateReferences(files);
}

function outputPath(source, output) {
  if (!output.endsWith('.zip')) throw new Error('output must be a .zip file');
  const within = relative(source, output);
  if (!within.startsWith('..') && !isAbsolute(within) && !within.startsWith('dist/')) throw new Error('output inside the source tree must be under dist/');
  // Check the destination itself, including dangling symlinks; existsSync alone
  // does not see a symlink whose target is missing.
  try {
    const stat = lstatSync(output);
    if (stat.isSymbolicLink()) throw new Error('output symlink is not allowed');
    if (!stat.isFile()) throw new Error('output must be a regular file');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let parent = dirname(output);
  while (!existsSync(parent)) parent = dirname(parent);
  if (lstatSync(parent).isSymbolicLink()) throw new Error('output parent symlink is not allowed');
}

function build(source, output) {
  const root = realpathSync(source);
  const inputs = new Map(INPUTS.map((rel) => [rel, sourceFile(root, rel)]));
  for (const [rel, body] of inputs) noSecrets(body, rel);
  const files = portableInputs(inputs);
  validateFiles(files);
  outputPath(root, output);
  mkdirSync(dirname(output), { recursive: true });
  const temporary = mkdtempSync(join(dirname(output), '.melxis-openai-build-'));
  try {
    const stage = join(temporary, 'stage');
    for (const [rel, body] of files) {
      mkdirSync(dirname(join(stage, rel)), { recursive: true });
      writeFileSync(join(stage, rel), body, { mode: 0o644 });
    }
    const archive = join(temporary, 'package.zip');
    const names = [...files.keys()].sort();
    execFileSync('zip', ['-X', '-q', archive, ...names], { cwd: stage, stdio: 'pipe' });
    execFileSync('unzip', ['-tqq', archive], { stdio: 'pipe' });
    const actualNames = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n').sort();
    if (JSON.stringify(actualNames) !== JSON.stringify(names)) throw new Error('archive entry list differs from the explicit allowlist');
    const actual = new Map(names.map((rel) => [rel, execFileSync('unzip', ['-p', archive, rel], { encoding: 'utf8', maxBuffer: 6 * 1024 * 1024 })]));
    for (const [rel, body] of actual) if (body !== files.get(rel)) throw new Error(`archive content differs from validated input: ${rel}`);
    validateFiles(actual);
    renameSync(archive, output);
    return { artifact: output, files: names.length, bytes: statSync(output).size, version: JSON.parse(files.get('plugin.json')).version };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

try {
  const args = process.argv.slice(2);
  let source = ROOT;
  let output;
  for (let i = 0; i < args.length; i += 2) {
    if (!['--source', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('usage: node scripts/build-openai-package.mjs [--source <directory>] [--output <file.zip>]');
    if (args[i] === '--source') source = resolve(args[i + 1]);
    else output = resolve(args[i + 1]);
  }
  output ??= join(source, `dist/melxis-openai-${JSON.parse(readFileSync(join(source, '.codex-plugin/plugin.json'), 'utf8')).version}.zip`);
  process.stdout.write(JSON.stringify(build(source, output)) + '\n');
} catch (error) {
  process.stderr.write(`OpenAI package build failed: ${error.message}\n`);
  process.exitCode = 1;
}
