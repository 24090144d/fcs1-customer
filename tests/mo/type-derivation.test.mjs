import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveMoType } from '../../app/api/uploads/finalize/mo-helpers.mjs';

test('deriveMoType maps MO and PM prefixes', () => {
  assert.equal(deriveMoType('MO-0033051-01'), 'MO');
  assert.equal(deriveMoType('PM-0099123-01'), 'PM');
});

test('deriveMoType rejects unknown prefixes', () => {
  assert.throws(() => deriveMoType('JO-0001'), /Invalid Job Order prefix/);
});
