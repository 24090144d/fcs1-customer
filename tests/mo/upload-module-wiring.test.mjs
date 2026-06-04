import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('database upload module type includes mo', () => {
  const source = read('types/index.ts');
  assert.match(source, /export type ModuleCodeDb\s*=\s*'im'\s*\|\s*'jo'\s*\|\s*'mo'/);
});

test('onboarding module allowlist includes MO', () => {
  const source = read('app/onboarding/page.tsx');
  assert.match(source, /KNOWN_MODULES:\s*ModuleCode\[\]\s*=\s*\['IM',\s*'JO',\s*'MO'\]/);
});

test('chunk upload route resolves mo staging rows', () => {
  const source = read('app/api/uploads/chunk/route.ts');
  assert.match(source, /type JobRow = \{ organization_id: string; module_code: 'im' \| 'jo' \| 'mo' \}/);
  assert.match(source, /job\.module_code === 'im'\s*\?\s*'im_staging_rows'\s*:\s*job\.module_code === 'jo'\s*\?\s*'jo_staging_rows'\s*:\s*'mo_staging_rows'/);
});
