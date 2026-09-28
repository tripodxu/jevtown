// 人群地形：成片 / 零散 / 说不准 的判定，以及置换检验的确定性与收缩。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crowdTerrain, permsFor } from '../public/shared/spatial.js';

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
