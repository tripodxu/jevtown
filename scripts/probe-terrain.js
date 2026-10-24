// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：crowdTerrain 的置换检验要多少 CPU？
//
// 免费档 Worker 每次请求只有 10ms CPU，而 showPost 首访一份冻结报告就要现算一次地形
// （terrainFor 只缓存重复访问，首访躲不掉）。这里量三件事：
//  1. 现状：四种真实规模的判定场（600 / 2100 / 5100 / 10000 人）各要多少 ms；
//  2. 拆相：置换循环里洗牌与 morans 各占多少——省 CPU 该砍哪边，量了再说；
//  3. 邻接预计算（CSR）：哪几格相邻在置换之间从不变化，变化的只有格上的取值；
//     把邻接一次性折成紧凑表，置换循环里不再每格每轮重算 x/y 与四向边界检查。
//     加法顺序与原来逐格逐向完全一致 ⇒ 双精度逐位相同。
//     探针把「改动前的 terrainOf」原样内联一份，与真实实现 deepEqual——探针跟实现漂了，
//     这里先红，而不是注释里的数字悄悄过期（probe-bandcost.js 同款纪律）。
import { crowdTerrain } from '../public/shared/spatial.js';
import { crowd } from '../public/shared/personas.js';
import { rng, hash32 } from '../public/shared/rng.js';
import { PRESETS } from '../public/shared/presets.js';

const KEYS = Object.keys(PRESETS.post.reactions);
const people = crowd('zh');
console.log(`人群 ${people.length} 人 · post 预设 ${KEYS.length} 种反应 · ${new Date().toISOString().slice(0, 10)}`);

/** 真实感的反应场：基础分布以 seeded 随机撒，判定区左上一片乐见（让 take() 有活干）。judged = 前 n 格。 */
function fieldOf(n, seed) {
  const bytes = new Uint8Array(people.length);
  const random = rng(hash32('probe-terrain', seed));
  const mix = [1, 1, 2, 2, 2, 3, 3, 3, 5, 6, 8]; // scrolled/read/liked 偏多，reposted/blocked 少量
  for (let i = 0; i < n; i++) bytes[i] = mix[Math.floor(random() * mix.length)];
  const side = Math.min(40, Math.floor(Math.sqrt(n)));
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (y * 100 + x < n) bytes[y * 100 + x] = 3; // 左上一块 liked（不越出判定区）
  return bytes;
}

const bench = (name, times, fn) => {
  fn(); fn();
  const t0 = performance.now();
  for (let i = 0; i < times; i++) fn();
  const ms = (performance.now() - t0) / times;
  console.log(`  ${name.padEnd(40)} ${ms.toFixed(3)} ms`);
  return ms;
};

// -- 改动前的 terrainOf：原样内联（含原 morans），与真实实现对拍 ------------------------
function moransOld(d, judged, grid, idx) {
  let degree = 0;
  let dot = 0;
  let sq = 0;
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

function terrainOld(presetId, keys, bytes, opts = {}) {
  const judged = new Uint8Array(bytes.length);
  const values = new Float64Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    if (!bytes[i]) continue;
    judged[i] = 1;
    values[i] = PRESETS[presetId].reactions[keys[bytes[i] - 1]]?.tone ?? 0;
  }
  const { versionId = '', grid = 100, maxCluster = 400 } = opts;
  const idx = [];
  for (let i = 0; i < judged.length; i++) if (judged[i]) idx.push(i);
  const quiet = (extra = {}) => ({ judged: idx.length, edges: 0, morans: null, z: null, p: null, perms: 0, verdict: 'unclear', hot: [], cold: [], hotAt: null, coldAt: null, ...extra });
  if (idx.length < 30) return quiet();
  const mean = idx.reduce((sum, i) => sum + values[i], 0) / idx.length;
  const d = new Float64Array(judged.length);
  for (const i of idx) d[i] = values[i] - mean;
  const observed = moransOld(d, judged, grid, idx);
  if (observed.i === null) return quiet({ edges: observed.edges });
  const perms = (n) => (n <= 2000 ? 199 : n <= 5000 ? 99 : 49);
  const count = perms(idx.length);
  const random = rng(hash32('spatial', versionId));
  const shuffled = idx.map((i) => values[i]);
  const work = new Float64Array(judged.length);
  const span = Math.abs(observed.i);
  let total = 0;
  let totalSq = 0;
  let extreme = 0;
  let used = 0;
  for (let r = 0; r < count; r++) {
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      const swap = shuffled[k];
      shuffled[k] = shuffled[j];
      shuffled[j] = swap;
    }
    for (let k = 0; k < idx.length; k++) work[idx[k]] = shuffled[k] - mean;
    const perm = moransOld(work, judged, grid, idx);
    if (perm.i === null) continue;
    used += 1;
    total += perm.i;
    totalSq += perm.i * perm.i;
    if (Math.abs(perm.i) >= span) extreme += 1;
  }
  if (!used) return quiet({ edges: observed.edges });
  const mu = total / used;
  const sigma = Math.sqrt(Math.max(0, totalSq / used - mu * mu));
  const stats = { judged: idx.length, edges: observed.edges, morans: observed.i, z: sigma > 0 ? (observed.i - mu) / sigma : null, p: (1 + extreme) / (1 + used), perms: used };
  const verdict = stats.p < 0.05 ? (observed.i > 0 ? 'clustered' : 'scattered') : 'unclear';
  if (verdict === 'unclear') return { ...quiet(stats) };
  const neighbourOf = (vals, i) => {
    const x = i % grid;
    const y = (i / grid) | 0;
    let nb = 0;
    if (x > 0 && judged[i - 1]) nb += vals[i - 1];
    if (x < grid - 1 && judged[i + 1]) nb += vals[i + 1];
    if (y > 0 && judged[i - grid]) nb += vals[i - grid];
    if (y < grid - 1 && judged[i + grid]) nb += vals[i + grid];
    return nb;
  };
  const scores = [];
  for (const i of idx) {
    const value = values[i];
    if (!value) continue;
    const around = neighbourOf(values, i);
    if (value * around <= 0) continue;
    scores.push({ i, l: Math.abs(value * around), hot: value > 0 });
  }
  const take = (positive) => {
    const pool = scores.filter((s) => s.hot === positive).sort((a, b) => b.l - a.l);
    if (!pool.length) return [];
    const cut = pool[0].l * 0.5;
    const kept = [];
    for (const s of pool) {
      if (kept.length >= maxCluster || s.l < cut) break;
      kept.push(s.i);
    }
    return kept;
  };
  const hot = take(true);
  const cold = take(false);
  const centre = (ids) => {
    if (!ids.length) return null;
    let x = 0;
    let y = 0;
    for (const i of ids) { x += i % grid; y += (i / grid) | 0; }
    return { x: Math.round(x / ids.length), y: Math.round(y / ids.length) };
  };
  return { ...stats, verdict, hot, cold, hotAt: centre(hot), coldAt: centre(cold) };
}

// -- 拆相：置换循环各相各占多少（新结构：CSR 邻接 + 紧凑值场），看时间地板在哪 ----------
function phasesOf(bytes) {
  const idx = [];
  for (let i = 0; i < bytes.length; i++) if (bytes[i]) idx.push(i);
  const n = idx.length;
  const values = new Float64Array(bytes.length);
  const judged = new Uint8Array(bytes.length);
  for (const i of idx) { judged[i] = 1; values[i] = ((bytes[i] % 3) || 0) - 0.5; }
  const mean = idx.reduce((sum, i) => sum + values[i], 0) / n;
  const perms = n <= 2000 ? 199 : n <= 5000 ? 99 : 49;

  // 与 spatial.js 改造后同构的三相（探针手写，量相用；逐位相同由上面 deepEqual 的主测量钉住）
  const at = new Int32Array(bytes.length);
  for (let k = 0; k < n; k++) at[idx[k]] = k;
  const buildAdj = () => {
    const nbr = new Int32Array(n * 4);
    const width = new Int32Array(n + 1);
    let degree = 0;
    let slot = 0;
    for (let k = 0; k < n; k++) {
      const i = idx[k];
      const x = i % 100;
      const y = (i / 100) | 0;
      if (x > 0 && judged[i - 1]) nbr[slot++] = at[i - 1];
      if (x < 99 && judged[i + 1]) nbr[slot++] = at[i + 1];
      if (y > 0 && judged[i - 100]) nbr[slot++] = at[i - 100];
      if (y < 99 && judged[i + 100]) nbr[slot++] = at[i + 100];
      degree += slot - width[k];
      width[k + 1] = slot;
    }
    return { nbr, width, degree };
  };
  const adj = buildAdj();
  const compactI = (vals) => {
    let dot = 0;
    let sq = 0;
    for (let k = 0; k < n; k++) {
      const d = vals[k];
      let nb = 0;
      for (let t = adj.width[k]; t < adj.width[k + 1]; t++) nb += vals[adj.nbr[t]];
      dot += d * nb;
      sq += d * d;
    }
    return adj.degree && sq ? (n / (adj.degree * 2)) * (dot / sq) : null;
  };
  const shuffled = new Float64Array(n);
  for (let k = 0; k < n; k++) shuffled[k] = values[idx[k]];
  const permVals = new Float64Array(n);

  bench(`  拆相 · 建邻接表（一次，${n} 格）`, 200, () => buildAdj().degree);
  bench(`  拆相 · 只洗牌（${perms} 次 × ${n} 人）`, 3, () => {
    const random = rng(hash32('spatial', 'phase'));
    for (let r = 0; r < perms; r++) {
      for (let k = shuffled.length - 1; k > 0; k--) {
        const j = Math.floor(random() * (k + 1));
        const swap = shuffled[k];
        shuffled[k] = shuffled[j];
        shuffled[j] = swap;
      }
    }
    return shuffled[0];
  });
  bench(`  拆相 · 只紧凑 I（跑 ${perms} 次）`, 3, () => {
    let acc = 0;
    for (let r = 0; r < perms; r++) acc += compactI(permVals) ?? 0;
    return acc;
  });
  bench(`  拆相 · 紧凑填充（${perms} 次 × ${n} 人）`, 3, () => {
    for (let r = 0; r < perms; r++) for (let k = 0; k < n; k++) permVals[k] = shuffled[k] - mean;
    return permVals[0];
  });
}

// -- 主测量 ----------------------------------------------------------------
for (const n of [600, 2100, 5100, 10000]) {
  const bytes = fieldOf(n, `s${n}`);
  console.log(`\n判定 ${n} 人（置换 ${n <= 2000 ? 199 : n <= 5000 ? 99 : 49} 次）：`);
  const real = crowdTerrain('post', KEYS, bytes, { versionId: `probe-${n}` });
  const old = terrainOld('post', KEYS, bytes, { versionId: `probe-${n}` });
  console.log(`  内联旧实现与真实实现 deepEqual：${JSON.stringify(real) === JSON.stringify(old)}（verdict=${real.verdict} I=${real.morans?.toFixed(3)} p=${real.p?.toFixed(3)} hot=${real.hot.length} cold=${real.cold.length}）`);
  bench('crowdTerrain 今天（真实实现）', 3, () => crowdTerrain('post', KEYS, bytes, { versionId: `probe-${n}` }));
  bench('crowdTerrain 改动前（内联旧实现）', 3, () => terrainOld('post', KEYS, bytes, { versionId: `probe-${n}` }));
  if (n === 600 || n === 10000) phasesOf(bytes);
}
