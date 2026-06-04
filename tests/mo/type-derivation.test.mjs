import test from 'node:test';
import assert from 'node:assert/strict';

function deriveMoType(jobOrder) {
  const normalized = String(jobOrder ?? '').trim().toUpperCase();
  if (normalized.startsWith('MO')) return 'MO';
  if (normalized.startsWith('PM')) return 'PM';
  throw new Error(`Invalid Job Order prefix: ${jobOrder}`);
}

test('deriveMoType maps MO and PM prefixes', () => {
  assert.equal(deriveMoType('MO-0033051-01'), 'MO');
  assert.equal(deriveMoType('PM-0099123-01'), 'PM');
});

test('deriveMoType rejects unknown prefixes', () => {
  assert.throws(() => deriveMoType('JO-0001'), /Invalid Job Order prefix/);
});
