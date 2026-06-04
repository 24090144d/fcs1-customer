import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'app', 'api', 'uploads', 'finalize', 'route.ts'), 'utf8');

test('finalize route recognizes mo module code and tables', () => {
  assert.match(source, /type JobRow = \{ organization_id: string; module_code: 'im' \| 'jo' \| 'mo'; source_name: string \| null \}/);
  assert.match(source, /const stagingTable\s*=\s*module_code === 'im'\s*\?\s*'im_staging_rows'\s*:\s*module_code === 'jo'\s*\?\s*'jo_staging_rows'\s*:\s*'mo_staging_rows'/);
  assert.match(source, /const recordTable\s*=\s*module_code === 'im'\s*\?\s*'im_records'\s*:\s*module_code === 'jo'\s*\?\s*'jo_records'\s*:\s*'mo_records'/);
  assert.match(source, /const dashboardTable\s*=\s*module_code === 'im'\s*\?\s*'im_dashboard_json'\s*:\s*module_code === 'jo'\s*\?\s*'jo_dashboard_json'\s*:\s*'mo_dashboard_json'/);
});

test('finalize route has explicit mo record branch with derived type', () => {
  assert.match(source, /else if \(module_code === 'mo'\)/);
  assert.match(source, /type:\s*deriveMoType\(rr\.job_order\)/);
});

test('finalize route can emit mo-v1 dashboard payloads', () => {
  assert.match(source, /generatedJson\.meta\.schema = 'mo-v1'/);
});
