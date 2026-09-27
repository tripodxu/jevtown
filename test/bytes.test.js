import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBytes, decodeBytes } from '../public/shared/bytes.js';

test('字节往返一致，且 base64 长度约为原 4/3', () => {
  const bytes = new Uint8Array(10000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 8;
  const text = encodeBytes(bytes);
  assert.equal(text.length, Math.ceil(10000 / 3) * 4);
  const back = decodeBytes(text);
  assert.deepEqual(Array.from(back), Array.from(bytes));
});

test('空字节与全零也能往返', () => {
  const bytes = new Uint8Array(6);
  assert.deepEqual(Array.from(decodeBytes(encodeBytes(bytes))), Array.from(bytes));
});
