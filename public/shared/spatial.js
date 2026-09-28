// 人群地形：把一万格的反应当空间场读一次——这次的乐见与反感是连成片的，还是零散的。
//
// 网格位置本身有含义（personas.js：年龄按行、兴趣按列，邻居就是相似的人），于是"哪一片人
// 一起反感"是真问题；而 summary.js 的 segments 是按属性做的边际统计，答不了它——成片往往
// 由属性的组合造成（预算紧的 × 对手机感兴趣的 × 同一片区的），单看任何一条属性条都看不出来。
// 传播算法本身也制造聚集（feed.js 给传播者的网格邻居加权），所以聚集可以测，不是渲染幻觉。
//
// 统计量是 Moran's I（rook 邻接，只连都被判定到的上下左右）：
//   d_i = tone_i - mean(tone)；nb_i = Σ 相邻且被判定 d_j
//   I = (n / (2·S0)) · (Σ d_i·nb_i) / (Σ d_i²)，S0 = Σ 各格判定邻居数 = 2E
// 合成图核对过：左上一块 +1 ⇒ I ≈ +0.80，+1/-1 棋盘 ⇒ I ≈ −0.50，全体同值 ⇒ null（无方差）。
// 显著性用置换检验（把态度在判定格之间重排），次数随人数收缩——人越多零分布越窄。
import { PRESETS } from './presets.js';
import { hash32, rng } from './rng.js';

/** 判定人数低于此不出结论：样本太小，I 的零分布不是钟形。 */
const MIN_JUDGED = 30;
/** 显著水平：p 低于它才算"成片"或"零散"。 */
const ALPHA = 0.05;

/** 置换次数：人越多零分布越窄，少几次也够判显著；199 次时 p 的最小值是 1/200 = 0.005。 */
export const permsFor = (n) => (n <= 2000 ? 199 : n <= 5000 ? 99 : 49);

/** 一格的态度（乐见 +1 / 反感 -1 / 其余 0）。没被判定到算 0——"还没轮到"不是中性。 */
const toneOf = (presetId, keys, byte) => (byte ? PRESETS[presetId].reactions[keys[byte - 1]]?.tone ?? 0 : 0);

/** 一遍扫描算出 I：d 已离均值。相邻只在"两边都被判定到"时才算。 */
function morans(d, judged, grid, idx) {
  let degree = 0; // S0：各格判定邻居数之和 = 2E
  let dot = 0; // Σ d_i·nb_i
  let sq = 0; // Σ d_i²
  for (const i of idx) {
    const x = i % grid;
    const y = (i / grid) | 0;
    let nb = 0;
    let deg = 0;
    if (x > 0 && judged[i - 1]) { nb += d[i - 1]; deg += 1; }
    if (x < grid - 1 && judged[i + 1]) { nb += d[i + 1]; deg += 1; }
    if (y > 0 && judged[i - grid]) { nb += d[i - grid]; deg += 1; }
    if (y < grid - 1 && judged[i + grid]) { nb += d[i + grid]; deg += 1; }
    degree += deg;
    dot += d[i] * nb;
    sq += d[i] * d[i];
  }
  if (!degree || !sq) return { i: null, edges: 0 };
  return { i: (idx.length / (degree * 2)) * (dot / sq), edges: degree / 2 };
}

/** 某格判定邻居上的取值之和（d 或原始态度都能传进来）。 */
function neighbourOf(values, judged, grid, i) {
  const x = i % grid;
  const y = (i / grid) | 0;
  let nb = 0;
  if (x > 0 && judged[i - 1]) nb += values[i - 1];
  if (x < grid - 1 && judged[i + 1]) nb += values[i + 1];
  if (y > 0 && judged[i - grid]) nb += values[i - grid];
  if (y < grid - 1 && judged[i + grid]) nb += values[i + grid];
  return nb;
}

/** 一组格子在网格上的重心（格坐标）。 */
const centre = (ids, grid) => {
  if (!ids.length) return null;
  let x = 0;
  let y = 0;
  for (const i of ids) {
    x += i % grid;
    y += (i / grid) | 0;
  }
  return { x: Math.round(x / ids.length), y: Math.round(y / ids.length) };
};

/**
 * 一次检查的地形。返回 null 的字段表示"下不了结论"，由界面说人话（labels.js 的 TERRAIN_*_ZH）。
 * hot / cold 是成片格子的 id 列表（各不超过 maxCluster），直接交给 grid.js 描环。
 * 同一 versionId 必得同一结果——置换用 seed 随机，回放与测试依赖这一点。
 */
export function crowdTerrain(presetId, keys, bytes, { versionId = '', grid = 100, maxCluster = 400 } = {}) {
  const judged = new Uint8Array(bytes.length);
  const tone = new Float64Array(bytes.length);
  const idx = [];
  for (let i = 0; i < bytes.length; i++) {
    if (!bytes[i]) continue;
    judged[i] = 1;
    tone[i] = toneOf(presetId, keys, bytes[i]);
    idx.push(i);
  }
  const quiet = (extra = {}) => ({
    judged: idx.length, edges: 0, morans: null, z: null, p: null, perms: 0,
    verdict: 'unclear', hot: [], cold: [], hotAt: null, coldAt: null, ...extra,
  });
  if (idx.length < MIN_JUDGED) return quiet();

  const mean = idx.reduce((sum, i) => sum + tone[i], 0) / idx.length;
  const d = new Float64Array(bytes.length);
  for (const i of idx) d[i] = tone[i] - mean;
  const observed = morans(d, judged, grid, idx);
  if (observed.i === null) return quiet({ edges: observed.edges });

  // 置换检验：把态度在判定格之间重排，看观测到的 I 在零分布里有多罕见。
  const perms = permsFor(idx.length);
  const random = rng(hash32('spatial', versionId));
  const values = idx.map((i) => tone[i]);
  const work = new Float64Array(bytes.length);
  const span = Math.abs(observed.i);
  let total = 0;
  let totalSq = 0;
  let extreme = 0;
  let used = 0;
  for (let r = 0; r < perms; r++) {
    for (let k = values.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      const swap = values[k];
      values[k] = values[j];
      values[j] = swap;
    }
    for (let k = 0; k < idx.length; k++) work[idx[k]] = values[k] - mean;
    const perm = morans(work, judged, grid, idx);
    if (perm.i === null) continue;
    used += 1;
    total += perm.i;
    totalSq += perm.i * perm.i;
    if (Math.abs(perm.i) >= span) extreme += 1;
  }
  if (!used) return quiet({ edges: observed.edges });
  const mu = total / used;
  const sigma = Math.sqrt(Math.max(0, totalSq / used - mu * mu));
  const stats = {
    judged: idx.length,
    edges: observed.edges,
    morans: observed.i,
    z: sigma > 0 ? (observed.i - mu) / sigma : null,
    p: (1 + extreme) / (1 + used),
    perms: used,
  };
  const verdict = stats.p < ALPHA ? (observed.i > 0 ? 'clustered' : 'scattered') : 'unclear';
  if (verdict === 'unclear') return { ...quiet(stats) };

  // 局部象限：**拿原始态度**（不是离均值偏差）判——自己与邻居同为乐见 = 成片的乐见，
  // 同为反感 = 成片的反感。中性格态度为 0，不参与，于是"一大片中性"不会被误报成
  // "成片的反感"（离均值看的话，中性多数派会整体落在均值下方，天然构成一块假冷区）。
  const scores = [];
  for (const i of idx) {
    const value = tone[i];
    if (!value) continue;
    const around = neighbourOf(tone, judged, grid, i);
    if (value * around <= 0) continue; // 与邻居反号：孤立点，不标
    scores.push({ i, l: Math.abs(value * around), hot: value > 0 });
  }
  const take = (positive) => {
    const pool = scores.filter((s) => s.hot === positive).sort((a, b) => b.l - a.l);
    if (!pool.length) return [];
    const cut = pool[0].l * 0.5; // 取"半高"以上：成片有多大就标多大
    const kept = [];
    for (const s of pool) {
      if (kept.length >= maxCluster || s.l < cut) break;
      kept.push(s.i);
    }
    return kept;
  };
  const hot = take(true);
  const cold = take(false);
  return { ...stats, verdict, hot, cold, hotAt: centre(hot, grid), coldAt: centre(cold, grid) };
}
