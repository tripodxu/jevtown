// 实时监控的增量统计：foldBatch 的幂等性、改判、未知反应，以及与全量重扫的对拍。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newTally, foldBatch } from '../public/tally.js';

const KEYS = ['scrolled_past', 'read', 'liked', 'disliked'];
const TONE = [0, 0, 1, -1]; // 序号 → 1/0/-1，与 presets.js 的 reaction.tone 同形
const indexOf = (reaction) => KEYS.indexOf(reaction);
const toneOf = (index) => TONE[index] ?? 0;

/** 全量重扫：从字节数组数出 judged/glad/sorry，用来和增量结果对拍。 */
const rescan = (bytes) => {
  const out = { judged: 0, glad: 0, sorry: 0 };
  for (const byte of bytes) {
    if (!byte) continue;
    out.judged += 1;
    const tone = TONE[byte - 1] ?? 0;
    if (tone === 1) out.glad += 1;
    if (tone === -1) out.sorry += 1;
  }
  return out;
};

test('newTally：一座空小镇，三个计数都是 0，字节全 0', () => {
  const tally = newTally(4);
  assert.deepEqual([...tally.bytes], [0, 0, 0, 0]);
  assert.equal(tally.judged + tally.glad + tally.sorry, 0);
});

test('foldBatch：一批折进快照，计数与字节都对', () => {
  const tally = newTally(3);
  foldBatch(tally, [{ id: 0, reaction: 'read' }, { id: 1, reaction: 'liked' }, { id: 2, reaction: 'disliked' }], indexOf, toneOf);
  assert.equal(tally.judged, 3);
  assert.equal(tally.glad, 1);
  assert.equal(tally.sorry, 1);
  assert.deepEqual([...tally.bytes], [2, 3, 4]);
});

test('foldBatch：同一批折两次不重复计（重试与重放都幂等）', () => {
  const tally = newTally(2);
  const batch = [{ id: 0, reaction: 'liked' }, { id: 1, reaction: 'disliked' }];
  foldBatch(tally, batch, indexOf, toneOf);
  foldBatch(tally, batch, indexOf, toneOf);
  assert.equal(tally.judged, 2);
  assert.equal(tally.glad, 1);
  assert.equal(tally.sorry, 1);
});

test('foldBatch：改判先撤旧再记新，计数不漂', () => {
  const tally = newTally(1);
  foldBatch(tally, [{ id: 0, reaction: 'liked' }], indexOf, toneOf);
  foldBatch(tally, [{ id: 0, reaction: 'disliked' }], indexOf, toneOf);
  assert.deepEqual([tally.judged, tally.glad, tally.sorry], [1, 0, 1]);
  foldBatch(tally, [{ id: 0, reaction: 'read' }], indexOf, toneOf);
  assert.deepEqual([tally.judged, tally.glad, tally.sorry], [1, 0, 0]);
});

test('foldBatch：不认识的反应跳过，不占人数', () => {
  const tally = newTally(2);
  foldBatch(tally, [{ id: 0, reaction: 'scam' }, { id: 1, reaction: 'read' }], indexOf, toneOf);
  assert.equal(tally.judged, 1);
  assert.equal(tally.bytes[0], 0);
  assert.equal(tally.bytes[1], 2);
});

test('foldBatch：一万格逐批折完，增量结果 === 全量重扫', () => {
  const tally = newTally(10000);
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 100; i++) {
    const batch = Array.from({ length: 100 }, (_, k) => {
      const id = i * 100 + k;
      return { id, reaction: KEYS[Math.floor(next() * KEYS.length)] };
    });
    foldBatch(tally, batch, indexOf, toneOf);
  }
  assert.equal(tally.judged, 10000);
  assert.deepEqual(
    { judged: tally.judged, glad: tally.glad, sorry: tally.sorry },
    rescan(tally.bytes),
  );
});
