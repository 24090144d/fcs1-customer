import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const dashboardPage = fs.readFileSync(path.join(repoRoot, 'app', 'dashboard', 'page.tsx'), 'utf8');
const navRoute = fs.readFileSync(path.join(repoRoot, 'app', 'api', 'nav', 'dashboards', 'route.ts'), 'utf8');

test('dashboard page resolves mo dashboard table and schema', () => {
  assert.match(dashboardPage, /function resolveDashboardTable\(moduleCode\?: string\): 'im_dashboard_json' \| 'jo_dashboard_json' \| 'mo_dashboard_json'/);
  assert.match(dashboardPage, /if \(mod === 'mo'\) return 'mo_dashboard_json'/);
  assert.match(dashboardPage, /const expectedSchema = String\(moduleCode \?\? ''\)\.toLowerCase\(\) === 'jo' \? 'jo-v1' : String\(moduleCode \?\? ''\)\.toLowerCase\(\) === 'mo' \? 'mo-v1' : 'im-v1'/);
});

test('nav route loads mo dashboard rows and exposes mo module', () => {
  assert.match(navRoute, /module:\s*'im' \| 'jo' \| 'mo'/);
  assert.match(navRoute, /sb\.from\('mo_dashboard_json'\)\.select\('generated_json, generated_at'\)/);
  assert.match(navRoute, /for \(const r of \(moRows \?\? \[\]\)\) addRow\('mo', r\)/);
});

test('nav route exposes corp mo item when at least two hotels exist', () => {
  assert.match(navRoute, /if \(hotelsForModule\.length >= 2\) \{/);
  assert.match(navRoute, /moduleCode === 'im' \? 'Corp · IM' : moduleCode === 'jo' \? 'Corp · JO' : 'Corp · MO'/);
  assert.match(navRoute, /href: `\/dashboard\?hotel=corp&chain=\$\{encodeURIComponent\(chain\)\}&module=\$\{moduleCode\}`/);
});
