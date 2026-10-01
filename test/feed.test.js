import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposure, firstWave, nextWave, mood, travels, WAVES, GLAD_ENOUGH, randomBaseline, moodZ } from '../public/shared/feed.js';
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

// R29：随机基线。这轮不改传播判据（用户选择「只交证据与展示」），但把「阈值在基线之下」
// 这件事钉成断言，免得后人以为 GLAD_ENOUGH 是「有信息」的线。
test('randomBaseline：均匀抽反应时的情绪均值与标准误', () => {
  const base = randomBaseline('post', 600);
  assert.ok(base.mean > 0, `随机基线为正（均匀抽到 glad 一侧），实测 ${base.mean}`);
  assert.ok(base.error > 0 && base.error < 0.1, `600 人的标准误应在 0.01 量级：${base.error}`);
  assert.ok(GLAD_ENOUGH < base.mean, 'GLAD_ENOUGH 画在随机基线之下：这条线不是「有信息」');
  // 人越多越接近均值：标准误随 1/sqrt(n) 缩
  const big = randomBaseline('post', 2400);
  assert.ok(big.error < base.error / 1.5, `标准误应随人数下降：${base.error} → ${big.error}`);
});

test('moodZ：z 是离随机几个标准误，符号跟方向一致', () => {
  const base = randomBaseline('post', 600);
  assert.equal(moodZ('post', base.mean, 600), 0);
  assert.ok(moodZ('post', base.mean + base.error, 600) > 0.9, '高一倍标准误就该 z≈1');
  assert.ok(moodZ('post', base.mean - base.error * 10, 600) < -9, '低十倍标准误就该 z≈-10');
  // 0.1 这条旧阈值在 iPhone（listing）实测里是 z=-2.31（比随机还冷却过了闸）
  assert.ok(moodZ('listing', 0.102, 600) < -2, '真实 Jev 第 1 波 0.102 低于随机基线两个标准误');
  assert.ok(randomBaseline('product', 600).mean > 0.3, '商品帖的随机基线高达 0.4：这条线对不同题材含义不同');
});
