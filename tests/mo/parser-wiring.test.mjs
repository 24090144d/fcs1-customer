import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('csv schema exposes MO required columns and validator', () => {
  const source = read('lib/validation/csvSchema.ts');
  assert.match(source, /export const MO_REQUIRED_COLUMNS = \[/);
  assert.match(source, /export function validateMoRow\(/);
  assert.match(source, /module === 'IM' \? IM_REQUIRED_COLUMNS\s*:\s*module === 'JO' \? JO_REQUIRED_COLUMNS\s*:\s*MO_REQUIRED_COLUMNS/);
});

test('parseCsv dispatches MO rows through validateMoRow', () => {
  const source = read('lib/csv/parseCsv.ts');
  assert.match(source, /validateHeaders,\s*validateImRow,\s*validateJoRow,\s*validateMoRow/);
  assert.match(source, /module === 'IM'\s*\?\s*validateImRow\(raw,\s*rowNum\)\s*:\s*module === 'JO'\s*\?\s*validateJoRow\(raw,\s*rowNum\)\s*:\s*validateMoRow\(raw,\s*rowNum\)/s);
});
