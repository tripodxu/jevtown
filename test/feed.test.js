import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposure, firstWave, nextWave, mood, travels, WAVES, GLAD_ENOUGH, randomBaseline, moodZ } from '../public/shared/feed.js';
import { persona, crowd } from '../public/shared/personas.js';
import { rng, hash32 } from '../public/shared/rng.js';

const scoresOf = (pairs) => Object.fromEntries(pairs);

/**
 * 每个可能的人群属性都打同一个分 ⇒ 一万人每个人的 exposure 完全相等，`pick()` 里那一万人
 * 全压在切线上。R31 修的平方级就长在这一形状上（真实触发它的是 Jev 给一组人群同样的低分）。
 */
const flatScores = () => {
  const scores = {};
  for (const who of crowd('zh')) {
    for (const id of [...who.interests.map((interest) => `interest:${interest}`), `field:${who.field}`, `age:${who.ageGroup}`]) {
      scores[id] = 0.5;
    }
  }
  return scores;
};

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

// R31：pick() 的切线补位曾是一段 rest.splice(i--, 1) 的扫描——人数压在切线上时是平方级，
// 而"一段文字在所有人群上得分一样"（Jev 给所有组同一个分数）恰好让一万人同时压在切线上。
// 这条用例把那一形状钉住：平坦的分数也要排满 wanted + random。
test('firstWave：分数全是同一个值时，一万人同压切线仍排满 wanted + random', () => {
  const people = crowd('zh');
  const wave = firstWave(people, flatScores(), 'post', rng(hash32('flat')));
  assert.equal(wave.length, WAVES[0].size, `平坦分数下仍应排满 ${WAVES[0].size} 人，实得 ${wave.length}`);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length, '不重复');
});

test('firstWave：同一颗种子必须给出同一波人（波次名单是存进 versions.plan 的检查结果）', () => {
  const people = crowd('zh');
  const scores = scoresOf([['interest:games', 1], ['field:it', 0.6], ['age:a25', 0.4]]);
  const a = firstWave(people, scores, 'post', rng(hash32('stable'))).map((who) => who.id);
  const b = firstWave(people, scores, 'post', rng(hash32('stable'))).map((who) => who.id);
  assert.deepEqual(a, b, '同种子两次必须逐 id 相同');
  const c = firstWave(people, scores, 'post', rng(hash32('stable', 2))).map((who) => who.id);
  assert.notDeepEqual(a, c, '不同种子应给出不同波');
});

// 切线上排不进 best 的人（旧实现里是 splice 后留在 rest 里的那批）仍可被随机抽中，
// 所以随机那 random 个人必须整段来自抽签池，且与 best 不重叠。
test('firstWave：抽签的人与排序的人不重叠，且整波不重复', () => {
  const people = crowd('zh');
  const wave = firstWave(people, flatScores(), 'post', rng(hash32('cut')));
  const wanted = WAVES[0].size - WAVES[0].random;
  assert.equal(wave.length, WAVES[0].size);
  assert.equal(new Set(wave.map((who) => who.id)).size, wave.length);
  // 前 wanted 个是按分排序的（平坦时分数全同，顺序即 id 顺序），后 random 个来自抽签
  assert.ok(wave.length - WAVES[0].random === wanted);
  const drawn = wave.slice(wanted).map((who) => who.id);
  assert.equal(new Set([...wave.slice(0, wanted).map((who) => who.id), ...drawn]).size, wave.length);
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
