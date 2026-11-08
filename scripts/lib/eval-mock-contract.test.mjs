import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const mockRoot = new URL('../../evals/mocks/melxis/', import.meta.url);
test('every advertised eval mock schema is dispatched by the actual agent mock', () => {
  const schemas = JSON.parse(readFileSync(new URL('_tools.json', mockRoot), 'utf8')).tools.map(({ name }) => name).sort();
  const text = readFileSync(new URL('_server.md', mockRoot), 'utf8');
  const dispatch = /^tools:\n((?:  - [^\n]+\n)+)/m.exec(text);
  assert.ok(dispatch, 'agent mock has no explicit dispatched tools');
  const names = [...dispatch[1].matchAll(/  - (\S+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, schemas, 'schemas alone do not expose guide tools to a real eval child');
});
