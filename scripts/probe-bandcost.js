// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：报告里现算全城 exposure 十档要多少 CPU？
//
// 免费档 Worker 每次请求只有 10ms CPU。报告请求今天只做 segments/topSegments/terrain；
// 若要新增「Jev 开局押得准吗」这一节，就得在报告路径上给全城一万格算 exposure 并切十档。
//
// 这一版量出三件事，第三件是我自己写的死循环：
//  1. 公开的 exposure() 每个人重建一次 83 列折立方表 → 全城一趟 20ms，撞死 10ms 预算；
//     feed.js 的 cubeTable/exposureBy 都是模块私有，报告路径拿不到，得另开「折一次、万人折一次」的入口。
//     折一次之后同一趟只要 0.137ms —— **差 145 倍**，所以这不是微优化，是这条路能不能走的分界。
//  2. 假打分必须用**真实的组 id**（groupsOf(market)），否则 at.get 全 undefined、exposure 恒 0。
//     第一版就是这么量出一段「区间 0.000–0.000」的废数。
//  3. 直方图数分位的写法 `while (seen < want) seen += hist[cuts.length]` 在遇到空桶时**死循环**：
//     hist 全落在少数桶里时 cuts.length 卡住不动、seen 永远追不上 want。第二版先线性扫一遍累加。
import { crowd } from '../public/shared/personas.js';
import { exposure, exposureAll, firstWave } from '../public/shared/feed.js';
import { groupsOf } from '../public/shared/requests.js';
import { rng, hash32 } from '../public/shared/rng.js';

const ids = groupsOf(true).map(([id]) => id);
const scores = {};
ids.forEach((id, i) => { scores[id] = i % 7 === 0 ? 1 : i % 7 === 1 ? 0.85 : (i % 11) / 11; });
const people = crowd('zh');
console.log(`真实组 id ${ids.length} 组 · 人 ${people.length} · 非零打分 ${Object.values(scores).filter((v) => v > 0).length}`);

const bench = (name, times, fn) => {
  fn(); fn();
  const t0 = performance.now();
  for (let i = 0; i < times; i++) fn();
  const ms = (performance.now() - t0) / times;
  console.log(`  ${name.padEnd(36)} ${ms.toFixed(3)} ms`);
  return ms;
};

const weightOf = { interest: 1, field: 1, age: 0.6, shopping: 1.5, budget: 0.6 };
const cubes = Float64Array.from(ids, (id) => (weightOf[id.slice(0, id.indexOf(':'))] * (scores[id] ?? 0)) ** 3);
const at = new Map(ids.map((id, index) => [id, index]));
const rows = people.map((who) => {
  const out = [];
  for (const it of who.interests) out.push(at.get(`interest:${it}`));
  out.push(at.get(`field:${who.field}`), at.get(`age:${who.ageGroup}`));
  if (who.shopping && who.shopping !== 'nothing') out.push(at.get(`shopping:${who.shopping}`));
  if (who.budget) out.push(at.get(`budget:${who.budget}`));
  return out;
});
const flat = new Int32Array(rows.reduce((a, r) => a + r.length, 0));
{ let k = 0; for (const r of rows) for (const v of r) flat[k++] = v; }
console.log(`  每人格列数 ${(flat.length / people.length).toFixed(2)} · 负号列 ${[...flat].filter((i) => i < 0).length}`);

const all = new Float64Array(people.length);
bench('折一次：全城一趟 exposure', 50, () => { for (let i = 0; i < people.length; i++) { let s = 0; const off = i * 7; for (let k = 0; k < 7; k++) s += cubes[flat[off + k]]; all[i] = s; } return all[0]; });
bench('折一次：按真行宽循环', 50, () => { for (let i = 0; i < people.length; i++) { let s = 0; const r = rows[i]; for (let k = 0; k < r.length; k++) s += cubes[r[k]]; all[i] = s; } return all[0]; });
let hi = 0; for (let i = 0; i < all.length; i++) if (all[i] > hi) hi = all[i];
console.log(`  exposure 区间 0.000–${hi.toFixed(3)}`);

const HIST = 2048;
bench('直方图数九个切点（线性累加）', 50, () => {
  const hist = new Int32Array(HIST);
  for (let i = 0; i < all.length; i++) hist[Math.min(HIST - 1, (all[i] * (HIST / hi)) | 0)] += 1;
  const cuts = [];
  let seen = 0;
  for (let b = 0; b < HIST && cuts.length < 9; b++) {
    seen += hist[b];
    let want = ((all.length * (cuts.length + 1)) / 10) | 0;
    while (seen >= want && cuts.length < 9) { cuts.push(((b + 1) * hi) / HIST); want = ((all.length * (cuts.length + 1)) / 10) | 0; }
  }
  return cuts.length;
});
bench('排序一次（Float64Array→Array→sort）', 20, () => { const a = [...all].sort((x, y) => x - y); return a[500]; });
const cuts = [];
for (let k = 1; k <= 9; k++) cuts.push((hi * k) / 10);
bench('分档：十档全城', 50, () => {
  const hits = new Int32Array(10);
  for (let i = 0; i < all.length; i++) { let d = 0; while (d < cuts.length && all[i] >= cuts[d]) d += 1; hits[d] += 1; }
  return hits[0];
});
bench('分档：只切到达的 2100 人', 50, () => {
  const hits = new Int32Array(10);
  for (let i = 0; i < 2100; i++) { let d = 0; while (d < cuts.length && all[i] >= cuts[d]) d += 1; hits[d] += 1; }
  return hits[0];
});
bench('对照：exposure() 逐人全城（每人重建折立方表）', 5, () => { let s = 0; for (const who of people) s += exposure(who, scores, 'listing'); return s; });

const wave1 = firstWave(people, scores, 'listing', rng(hash32('waves', 'zh', 'probe')));
const h = new Int32Array(10);
for (const who of wave1) { const e = all[who.id]; let d = 0; while (d < cuts.length && e >= cuts[d]) d += 1; h[d] += 1; }
console.log(`  第 1 波 ${wave1.length} 人落在十档 ${[...h].join(' / ')}`);
// -- 报告路径第二版（2026-10-18）：行复用与「分档+计数一趟」 ---------------------------
// 两处改动都在 feed.js 里，量法与上面同一套，并且先用逐位相等把探针手写的两条路钉在真实
// 实现上：探针跟实现漂了，这里先红，而不是注释里的数字悄悄过期。
{
  const off = new Int32Array(people.length + 1);
  for (let i = 0; i < people.length; i++) off[i + 1] = off[i] + rows[i].length;
  const ids = new Int32Array(off[people.length]);
  { let k = 0; for (let i = 0; i < people.length; i++) for (const v of rows[i]) ids[k++] = v; }
  const foldInto = (out, cs, offsets, flat) => {
    for (let i = 0; i < people.length; i++) {
      let sum = 0;
      for (let k = offsets[i]; k < offsets[i + 1]; k++) sum += cs[flat[k]];
      out[i] = sum;
    }
    return out.length;
  };
  const out2 = new Float64Array(people.length);
  const batch = exposureAll(people, scores, 'listing');
  foldInto(out2, cubes, off, ids);
  let sameDoubles = true;
  for (let i = 0; i < batch.length; i++) if (batch[i] !== out2[i]) sameDoubles = false;
  console.log('  批量入口 exposureAll 与探针折法逐位相同：' + sameDoubles);
  bench('报告：复用排好的行，全城一趟', 50, () => foldInto(out2, cubes, off, ids));
  bench('报告：每次都重排一次行（改动前）', 20, () => {
    const o = new Int32Array(people.length + 1);
    for (let i = 0; i < people.length; i++) o[i + 1] = o[i] + rows[i].length;
    const f = new Int32Array(o[people.length]);
    let k = 0;
    for (let i = 0; i < people.length; i++) for (const v of rows[i]) f[k++] = v;
    return foldInto(new Float64Array(people.length), cubes, o, f);
  });

  // 十档：旧写法把每人的档写进 Int32Array（40KB），再走第二趟读回来数；新写法一趟里数完。
  const nKeys = 6;
  const toneOf = new Int8Array(nKeys + 1);
  const stoppedOf = new Uint8Array(nKeys + 1);
  for (let k = 1; k <= nKeys; k++) { toneOf[k] = k % 3 === 0 ? -1 : 1; stoppedOf[k] = k % 2; }
  const bytes = Uint8Array.from({ length: people.length }, (_, i) => (i * 7) % (nKeys + 1));
  const cuts9 = [];
  for (let k = 1; k <= 9; k++) cuts9.push((hi * k) / 10);
  const freshRows = () => Array.from({ length: 10 }, () => ({ people: 0, reached: 0, stopped: 0, glad: 0, sorry: 0 }));
  const twoPass = () => {
    const slots = new Int32Array(all.length);
    for (let i = 0; i < all.length; i++) { let d = 0; while (d < cuts9.length && all[i] >= cuts9[d]) d += 1; slots[i] = d; }
    const rs = freshRows();
    for (let i = 0; i < all.length; i++) {
      const row = rs[slots[i]];
      row.people += 1;
      const byte = bytes[i];
      if (!byte) continue;
      row.reached += 1;
      const stopped = stoppedOf[byte];
      row.stopped += stopped;
      const tone = toneOf[byte];
      if (tone === 1) row.glad += 1; else if (tone === -1) row.sorry += 1;
    }
    return rs;
  };
  const onePass = () => {
    const rs = freshRows();
    for (let i = 0; i < all.length; i++) {
      let d = 0;
      while (d < cuts9.length && all[i] >= cuts9[d]) d += 1;
      const row = rs[d];
      row.people += 1;
      const byte = bytes[i];
      if (!byte) continue;
      row.reached += 1;
      const stopped = stoppedOf[byte];
      row.stopped += stopped;
      const tone = toneOf[byte];
      if (tone === 1) row.glad += 1; else if (tone === -1) row.sorry += 1;
    }
    return rs;
  };
  const shape = (rs) => rs.map((r) => r.people + ':' + r.reached + ':' + r.stopped + ':' + r.glad + ':' + r.sorry).join(',');
  console.log('  十档一趟与两趟读数相同：' + (shape(twoPass()) === shape(onePass())));
  bench('十档：先写满 slots 再读一遍（改动前）', 50, () => twoPass()[0].people);
  bench('十档：分档与计数一趟（今天）', 50, () => onePass()[0].people);
}
