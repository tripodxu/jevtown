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
export function crowdTerrain(presetId, keys, bytes, opts = {}) {
  const judged = new Uint8Array(bytes.length);
  const values = new Float64Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    if (!bytes[i]) continue;
    judged[i] = 1;
    values[i] = PRESETS[presetId].reactions[keys[bytes[i] - 1]]?.tone ?? 0;
  }
  return terrainOf(values, judged, opts);
}

/**
 * 一个"已给值"的场做空间统计：terrainOf 是 crowdTerrain 的真身。
 * values[i] 是格子 i 的取值（未判定记 0），judged[i]=1 表示这一格被判定到。
 * crowdDelta 直接复用它——把"两版态度之差"当成场，统计代码一行都不用重写。
 */
export function terrainOf(values, judged, { versionId = '', grid = 100, maxCluster = 400 } = {}) {
  const idx = [];
  for (let i = 0; i < judged.length; i++) if (judged[i]) idx.push(i);
  const quiet = (extra = {}) => ({
    judged: idx.length, edges: 0, morans: null, z: null, p: null, perms: 0,
    verdict: 'unclear', hot: [], cold: [], hotAt: null, coldAt: null, ...extra,
  });
  if (idx.length < MIN_JUDGED) return quiet();

  const mean = idx.reduce((sum, i) => sum + values[i], 0) / idx.length;
  const d = new Float64Array(judged.length);
  for (const i of idx) d[i] = values[i] - mean;
  const observed = morans(d, judged, grid, idx);
  if (observed.i === null) return quiet({ edges: observed.edges });

  // 置换检验：把取值在判定格之间重排，看观测到的 I 在零分布里有多罕见。
  const perms = permsFor(idx.length);
  const random = rng(hash32('spatial', versionId));
  const shuffled = idx.map((i) => values[i]);
  const work = new Float64Array(judged.length);
  const span = Math.abs(observed.i);
  let total = 0;
  let totalSq = 0;
  let extreme = 0;
  let used = 0;
  for (let r = 0; r < perms; r++) {
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      const swap = shuffled[k];
      shuffled[k] = shuffled[j];
      shuffled[j] = swap;
    }
    for (let k = 0; k < idx.length; k++) work[idx[k]] = shuffled[k] - mean;
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

  // 局部象限：**拿原始取值**（不是离均值偏差）判——自己与邻居同为乐见 = 成片的乐见，
  // 同为反感 = 成片的反感。取值为 0 的中性格不参与，于是"一大片中性"不会被误报成
  // "成片的反感"（离均值看的话，中性多数派会整体落在均值下方，天然构成一块假冷区）。
  const scores = [];
  for (const i of idx) {
    const value = values[i];
    if (!value) continue;
    const around = neighbourOf(values, judged, grid, i);
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

/**
 * 两版之差。返回一张"态度差"场（tone_新 - tone_旧 ∈ {-2..2}）与它的空间统计。
 *
 * 只统计**两版都判定到**的人：只被一版排到的人不是"变得中立了"，而是"这次没轮到"，
 * 混进来会得出"你改完稿子几千人不看了"这种结论错误的说法。覆盖差异另计为
 * onlyBefore / onlyAfter，由界面单独一句话说明。
 *
 * codes 打包给界面：code = delta + 3（delta ∈ {-2..2} ⇒ 1..5），0 = 不可比。
 * 于是"一格差值为 0"（3）与"这一格没被两版同时看到"（0）分得开。
 */
export function crowdDelta(presetId, keys, before, after, { versionId = '', grid = 100, maxCluster = 400 } = {}) {
  const size = Math.min(before.length, after.length);
  const judged = new Uint8Array(size);
  const values = new Float64Array(size);
  const codes = new Uint8Array(size);
  let both = 0;
  let onlyBefore = 0;
  let onlyAfter = 0;
  let up = 0;
  let down = 0;
  let net = 0;
  const tone = (bytes, i) => PRESETS[presetId].reactions[keys[bytes[i] - 1]]?.tone ?? 0;
  for (let i = 0; i < size; i++) {
    const a = before[i];
    const b = after[i];
    if (a && b) {
      const delta = tone(after, i) - tone(before, i);
      judged[i] = 1;
      values[i] = delta;
      codes[i] = delta + 3;
      both += 1;
      net += delta;
      if (delta > 0) up += 1;
      else if (delta < 0) down += 1;
    } else if (a) onlyBefore += 1;
    else if (b) onlyAfter += 1;
  }
  return {
    both,
    onlyBefore,
    onlyAfter,
    up,
    down,
    net,
    codes,
    terrain: terrainOf(values, judged, { versionId: `delta:${versionId}`, grid, maxCluster }),
  };
}
