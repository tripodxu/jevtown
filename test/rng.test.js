import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unit, rng, pickWeighted, hash32 } from '../public/shared/rng.js';

test('unit 对同样的输入永远给同一个数', () => {
  assert.equal(unit('a', 1, 'x'), unit('a', 1, 'x'));
  assert.notEqual(unit('a', 1, 'x'), unit('a', 2, 'x'));
});

test('unit 落在 [0, 1)', () => {
  for (let i = 0; i < 1000; i++) {
    const value = unit('range', i);
    assert.ok(value >= 0 && value < 1);
  }
});

test('rng(seed) 是确定性的', () => {
  const a = rng(hash32('seed', 1));
  const b = rng(hash32('seed', 1));
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test('pickWeighted 按权重挑，极端权重必中', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  assert.equal(pickWeighted(items, () => 0, 0.99).id, 'b');
  assert.equal(pickWeighted(items, (item) => (item.id === 'a' ? 10 : 0), 0.99).id, 'a');
});
