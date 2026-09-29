// 人群地形：成片 / 零散 / 说不准 的判定，以及置换检验的确定性与收缩。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crowdTerrain, crowdDelta, permsFor } from '../public/shared/spatial.js';

// 'post' 的反应顺序：scrolled_past(1) read(2) liked(3) disliked(4) reposted(5) followed(6) blocked(7) cant_tell(8)
const KEYS = ['scrolled_past', 'read', 'liked', 'disliked', 'reposted', 'followed', 'blocked', 'cant_tell'];
const LIKED = 3;
const DISLIKED = 4;
const NEUTRAL = 2;
const G = 10; // 测试用 10×10 小网格
const bytesOf = (at) => Uint8Array.from(at);

/** 全判定，左上 4×4 一块 +1，其余 0 —— 该判"成片"。 */
const patch = () => bytesOf(Array.from({ length: G * G }, (_, i) => ((i % G) < 4 && ((i / G) | 0) < 4 ? LIKED : NEUTRAL)));

/** 全判定，+1/-1 棋盘 —— 该判"零散"。 */
const checkerboard = () => bytesOf(Array.from({ length: G * G }, (_, i) => (((i % G) + ((i / G) | 0)) % 2 ? LIKED : DISLIKED)));

test('判定不足：不到 30 人不出结论', () => {
  const bytes = new Uint8Array(G * G);
  for (let i = 0; i < 10; i++) bytes[i] = LIKED;
  const t = crowdTerrain('post', KEYS, bytes, { grid: G, versionId: 'v1' });
  assert.equal(t.morans, null);
  assert.equal(t.verdict, 'unclear');
  assert.equal(t.judged, 10);
});

test('全体同值：没有方差就不出结论', () => {
  const t = crowdTerrain('post', KEYS, bytesOf(Array.from({ length: G * G }, () => LIKED)), { grid: G, versionId: 'v1' });
  assert.equal(t.morans, null);
  assert.equal(t.verdict, 'unclear');
});

test('成片：左上角一块乐见 ⇒ I 为正、判定 clustered、成片格落在左上', () => {
  const t = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'v1' });
  assert.ok(t.morans > 0.3, `I 应显著为正，实际 ${t.morans}`);
  assert.equal(t.verdict, 'clustered');
  assert.ok(t.p < 0.05, `p 应显著，实际 ${t.p}`);
  assert.ok(t.hot.length > 0, '应标出成片的乐见');
  assert.equal(t.cold.length, 0);
  assert.ok(t.hotAt.x < G / 2 && t.hotAt.y < G / 2, `重心应在左上，实际 ${t.hotAt.x},${t.hotAt.y}`);
  for (const id of t.hot) {
    assert.equal((id % G) < 4 && ((id / G) | 0) < 4, true, '成片格只应落在那一块里');
  }
});

test('零散：+1/-1 棋盘 ⇒ I 为负、判定 scattered', () => {
  const t = crowdTerrain('post', KEYS, checkerboard(), { grid: G, versionId: 'v1' });
  assert.ok(t.morans < -0.2, `I 应显著为负，实际 ${t.morans}`);
  assert.equal(t.verdict, 'scattered');
  assert.equal(t.hot.length, 0);
  assert.equal(t.cold.length, 0, '正负相间时没有哪一片同号，不该标成片');
});

test('确定性：同一输入两次完全一致（置换用 seed 随机）', () => {
  const a = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'same' });
  const b = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'same' });
  assert.deepEqual(a, b);
  const c = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'other' });
  assert.equal(c.morans, a.morans, '换 seed 只动零分布，不动观测值');
  assert.equal(c.hot.length, a.hot.length, '成片格的挑法也不依赖 seed');
});

test('置换次数随判定人数收缩（大阵省 CPU）', () => {
  assert.equal(permsFor(600), 199);
  assert.equal(permsFor(2000), 199);
  assert.equal(permsFor(3000), 99);
  assert.equal(permsFor(5000), 99);
  assert.equal(permsFor(9000), 49);
});

test('成片格与反感格互不重叠，且都只落在被判定到的格子上', () => {
  const at = checkerboard();
  at.fill(NEUTRAL);
  for (let y = 0; y < G; y++) {
    for (let x = 0; x < G; x++) {
      if (x < 4 && y < 4) at[y * G + x] = LIKED;
      if (x >= 6 && y >= 6) at[y * G + x] = DISLIKED;
    }
  }
  const t = crowdTerrain('post', KEYS, at, { grid: G, versionId: 'v1' });
  const hot = new Set(t.hot);
  assert.equal(t.verdict, 'clustered');
  assert.ok(t.hot.length > 0, '左上应标出成片的乐见');
  assert.ok(t.cold.length > 0, '右下应标出成片的反感');
  for (const id of t.cold) {
    assert.equal(at[id], DISLIKED, '聚集格必须是被判定到的');
    assert.equal(hot.has(id), false, '同一格不能既是乐见聚集又是反感聚集');
    assert.ok(id % G >= 6 && ((id / G) | 0) >= 6, '反感聚集应落在右下那一块');
  }
});

test('maxCluster 生效：成片再多也只交出这么多格', () => {
  const t = crowdTerrain('post', KEYS, patch(), { grid: G, versionId: 'v1', maxCluster: 3 });
  assert.equal(t.hot.length, 3);
});

// -- 两版之差 ------------------------------------------------------------

const deltaOf = (before, after) => crowdDelta('post', KEYS, before, after, { grid: G, versionId: 'd1' });

test('crowdDelta：只统计两版都判定到的人，单版覆盖另计', () => {
  const before = new Uint8Array(G * G);
  const after = new Uint8Array(G * G);
  for (let i = 0; i < 50; i++) before[i] = NEUTRAL; // 0..49 只有第 1 版看到
  for (let i = 25; i < 80; i++) after[i] = NEUTRAL; // 25..79 第 2 版看到
  const d = deltaOf(before, after);
  assert.equal(d.both, 25, '交集 25..49 共 25 人');
  assert.equal(d.onlyBefore, 25, '0..24 只有第 1 版看到');
  assert.equal(d.onlyAfter, 30, '50..79 只有第 2 版看到');
  // 80..99 两版都没排到，不进任何一段——三段之和是"至少被一版排到的人"，不是全城
  assert.equal(d.both + d.onlyBefore + d.onlyAfter, 80);
});

test('crowdDelta：差值 = 新态度 - 旧态度，向上向下分别计数', () => {
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  // 0..9 中性 → 乐见（+1）；10..19 乐见 → 中性（-1）；20..24 反感 → 乐见（+2）
  for (let i = 0; i < 10; i++) after[i] = LIKED;
  for (let i = 10; i < 20; i++) before[i] = LIKED;
  for (let i = 20; i < 25; i++) { before[i] = DISLIKED; after[i] = LIKED; }
  const d = deltaOf(before, after);
  assert.equal(d.up, 15, '0..9 是 +1，20..24 是 +2');
  assert.equal(d.down, 10, '10..19 是 -1');
  assert.equal(d.net, 10 * 1 + 5 * 2 - 10 * 1, 'net = Σ delta');
  assert.equal(d.codes[0], 4, 'delta=+1 ⇒ code 4');
  assert.equal(d.codes[20], 5, 'delta=+2 ⇒ code 5');
  assert.equal(d.codes[10], 2, 'delta=-1 ⇒ code 2');
  assert.equal(d.codes[30], 3, 'delta=0 ⇒ code 3（不是"不可比"的 0）');
});

test('crowdDelta：不可比的格子 code=0，与"差值为 0"分得开', () => {
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G); // 第 2 版一个人都没判定到
  const d = deltaOf(before, after);
  assert.equal(d.both, 0);
  assert.equal(d.onlyBefore, G * G);
  assert.equal(d.terrain.morans, null, '交集为空 ⇒ 不出结论');
  for (const code of d.codes) assert.equal(code, 0);
});

test('crowdDelta：差场也能判成片/零散（把 Moran I 套在差场上）', () => {
  // 左上 4×4 那一块从"划走"翻成"点赞"，其余不变 ⇒ 差场正相关 ⇒ clustered
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) after[y * G + x] = LIKED;
  const d = deltaOf(before, after);
  assert.equal(d.terrain.verdict, 'clustered');
  assert.ok(d.terrain.morans > 0, `差场的 I 应为正，实际 ${d.terrain.morans}`);
  assert.ok(d.terrain.hot.length > 0, '应标出成片变好的格子');
  assert.equal(d.terrain.cold.length, 0);
});

test('crowdDelta：逐格反号（真棋盘）判零散', () => {
  // 注意按 (x+y) 奇偶取反才是棋盘：G 是偶数，直接用 i % 2 得到的是**竖条纹**
  // （竖直邻居同号），那不是"逐格反号"，实测会判成 unclear。
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  for (let i = 0; i < G * G; i++) after[i] = (((i % G) + ((i / G) | 0)) % 2) ? LIKED : DISLIKED;
  const d = deltaOf(before, after);
  assert.equal(d.terrain.verdict, 'scattered');
  assert.ok(d.terrain.morans < 0);
});

test('crowdDelta：确定性——同输入两次完全一致', () => {
  const before = new Uint8Array(G * G).fill(NEUTRAL);
  const after = new Uint8Array(G * G).fill(NEUTRAL);
  for (let i = 0; i < 40; i++) after[i] = LIKED;
  assert.deepEqual(deltaOf(before, after), deltaOf(before, after));
});

test('crowdDelta：真实默认网格（100×100）也能跑', () => {
  const n = 10000;
  const before = new Uint8Array(n);
  const after = new Uint8Array(n);
  for (let i = 0; i < 3000; i++) { before[i] = NEUTRAL; after[i] = i < 900 ? LIKED : NEUTRAL; }
  const d = crowdDelta('post', KEYS, before, after, { versionId: 'real' });
  assert.equal(d.both, 3000);
  assert.equal(d.up, 900);
  assert.ok(['clustered', 'scattered', 'unclear'].includes(d.terrain.verdict));
});
