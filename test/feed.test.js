import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposure, firstWave, nextWave, mood, travels, WAVES, GLAD_ENOUGH } from '../public/shared/feed.js';
import { persona, crowd } from '../public/shared/personas.js';
import { rng, hash32 } from '../public/shared/rng.js';

const scoresOf = (pairs) => Object.fromEntries(pairs);

test('exposure：强对口的属性靠立方拉开差距', () => {
  const who = persona('zh', 77);
  const flat = scoresOf([[`interest:${who.interests[0]}`, 0.4]]);
  const strong = scoresOf([[`interest:${who.interests[0]}`, 0.9]]);
  assert.ok(exposure(who, strong, 'post') > 4 * exposure(who, flat, 'post'));
});

test('firstWave：最多 600 人、不重复、按曝光排序', () => {
  const people = crowd('zh');
  const scores = scoresOf([['interest:games', 1], ['field:it', 0.6], ['age:a25', 0.4]]);
  const wave = firstWave(people, scores, 'post', rng(hash32('t1')));
  assert.ok(wave.length <= WAVES[0].size);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length);
  // 对口的兴趣组里的人应该占大头
  const matched = wave.filter((who) => who.interests.includes('games')).length;
  assert.ok(matched > 100, `对口人数过少：${matched}`);
});

test('nextWave：不再包含已到达的人', () => {
  const people = crowd('zh');
  const scores = scoresOf([['interest:games', 1]]);
  const wave1 = firstWave(people, scores, 'post', rng(hash32('t2')));
  const reactions = new Map(wave1.map((who) => [who.id, 'liked']));
  const wave2 = nextWave(people, reactions, scores, 'post', 1, rng(hash32('t2', 2)));
  assert.ok(wave2.length <= WAVES[1].size);
  for (const who of wave2) assert.ok(!reactions.has(who.id));
});

test('mood/travels：glad 多一截才传播，阈值是 0.1', () => {
  assert.equal(GLAD_ENOUGH, 0.1);
  // 1 赞 3 划走：+0.25 ≥ 0.1，传播
  assert.ok(travels('post', ['liked', 'liked', 'liked', 'scrolled_past']));
  assert.ok(travels('post', ['liked', 'scrolled_past', 'scrolled_past', 'scrolled_past']));
  // 1 赞 1 反感 2 划走：净情绪 0，不传播
  assert.ok(!travels('post', ['liked', 'disliked', 'scrolled_past', 'scrolled_past']));
  assert.equal(mood('post', ['liked']), 1);
  assert.equal(mood('post', ['blocked']), -1);
});
