import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const schemaSql = fs.readFileSync(path.join(repoRoot, 'sql', 'schema.sql'), 'utf8');
const migrationSql = fs.readFileSync(path.join(repoRoot, 'sql', 'migrations', '008_mo_schema.sql'), 'utf8');

function assertSupportsMoChartDefinitions(source) {
  assert.match(
    source,
    /ai_chart_definitions_module_code_check[\s\S]*array\['im'::text,\s*'jo'::text,\s*'mo'::text\]/i,
  );
}

function assertConstrainsMaintenanceType(source) {
  assert.match(
    source,
    /type text not null[\s\S]*?(?:constraint\s+mo_records_type_check[\s\S]*?)?check\s*\(\s*\(?type\s*=\s*any\s*\(\s*array\['MO'::text,\s*'PM'::text\]\s*\)\)?\s*\)/i,
  );
}

test('schema.sql supports MO module in AI chart definitions', () => {
  assertSupportsMoChartDefinitions(schemaSql);
});

test('migration supports MO module in AI chart definitions', () => {
  assertSupportsMoChartDefinitions(migrationSql);
});

test('schema.sql constrains mo_records.type to MO and PM', () => {
  assertConstrainsMaintenanceType(schemaSql);
});

test('migration constrains mo_records.type to MO and PM', () => {
  assertConstrainsMaintenanceType(migrationSql);
});
