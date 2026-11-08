import { isDeepStrictEqual } from 'node:util';

// This bounded validator supports every assertion in the two vendored 1.0.0
// schemas. It is not a general JSON Schema implementation. Fail closed if a
// future schema adds a keyword we have not implemented.
const KEYWORDS = new Set([
  '$schema', '$id', '$ref', '$defs', 'title', 'description', 'type', 'const',
  'enum', 'not', 'oneOf', 'minLength', 'maxLength', 'pattern', 'properties',
  'required', 'additionalProperties', 'propertyNames', 'items',
]);

function supported(schema) {
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) throw new Error(`unsupported schema keyword ${key}`);
  }
  for (const map of [schema.$defs, schema.properties]) {
    for (const child of Object.values(map ?? {})) supported(child);
  }
  for (const child of schema.oneOf ?? []) supported(child);
  for (const child of [schema.not, schema.items, schema.propertyNames, schema.additionalProperties]) {
    if (child && typeof child === 'object') supported(child);
  }
}

export function validatePackageSchema(value, schema, label = 'package', root = schema) {
  if (root === schema) supported(root);
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) throw new Error(`${label}: unsupported schema keyword ${key}`);
  }
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) throw new Error(`${label}: only local schema references are supported`);
    const target = schema.$ref.slice(2).split('/').reduce((s, key) => s?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    if (!target) throw new Error(`${label}: unresolved schema reference ${schema.$ref}`);
    validatePackageSchema(value, target, label, root);
  }
  if ('const' in schema && !isDeepStrictEqual(value, schema.const)) throw new Error(`${label}: wrong schema constant`);
  if (schema.enum && !schema.enum.some((v) => isDeepStrictEqual(v, value))) throw new Error(`${label}: value outside schema enum`);
  if (schema.not) {
    let matches = true;
    try { validatePackageSchema(value, schema.not, label, root); } catch { matches = false; }
    if (matches) throw new Error(`${label}: forbidden schema value`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => {
      try { validatePackageSchema(value, branch, label, root); return true; } catch { return false; }
    });
    if (matches.length !== 1) throw new Error(`${label}: expected exactly one matching schema branch`);
  }
  if (schema.type) {
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (actual !== schema.type) throw new Error(`${label}: expected ${schema.type}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (schema.minLength !== undefined && length < schema.minLength) throw new Error(`${label}: string too short`);
    if (schema.maxLength !== undefined && length > schema.maxLength) throw new Error(`${label}: string too long`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) throw new Error(`${label}: pattern mismatch`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => validatePackageSchema(item, schema.items, `${label}[${i}]`, root));
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) throw new Error(`${label}: missing ${key}`);
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.propertyNames) validatePackageSchema(key, schema.propertyNames, `${label} property name`, root);
      const property = schema.properties?.[key];
      if (property) validatePackageSchema(item, property, `${label}.${key}`, root);
      else if (schema.additionalProperties === false) throw new Error(`${label}: unexpected property ${key}`);
      else if (typeof schema.additionalProperties === 'object') validatePackageSchema(item, schema.additionalProperties, `${label}.${key}`, root);
    }
  }
}
