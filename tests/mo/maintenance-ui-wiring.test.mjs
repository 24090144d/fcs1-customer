import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const source = fs.readFileSync(path.join(repoRoot, 'app', 'dashboard', 'DashboardClient.tsx'), 'utf8');

test('dashboard client tracks mo module state', () => {
  assert.match(source, /const isMo = data\.meta\.schema === 'mo-v1'/);
});

test('dashboard client exposes maintenance type switcher', () => {
  assert.match(source, /useState<MaintenanceType>\('MO'\)/);
  assert.match(source, />MO<\/button>/);
  assert.match(source, />PM<\/button>/);
});
