// 一次性探针：第 1 波到底是谁先看到的——把 exposure 的形状量清楚，再问两个问题：
//
//   1. 「谁先看到」在报告里有没有说？现在报告只有「谁停下了/乐见/反感」（segments 的边际统计，
//      那是所有人的账）。但第 1 波 600 人是被 exposure 排序挑出来的，而 exposure 就是 Jev 开局
//      那 83 组分数的折立方和。Jev 说这些人该先看到 —— 这个判断在整个产品里只被用来排序，
//      从来没被展示过。
//   2. 它有形状吗？真实 Jev 量下来有（见 tmp-real1.txt / tmp-real2.txt），但形状是「一两个人的
//      属性组合」还是「一组组的人」？下面的逐人格读数答这个。
//
// 用法：node scripts/probe-exposure.js [--real] [--preset listing] "文本"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowd } from '../public/shared/personas.js';
import { openingRequest, openingAnswers, groupsOf } from '../public/shared/requests.js';
import { exposure, firstWave } from '../public/shared/feed.js';
import { pickProvider, ask as askJev } from '../public/shared/jev.js';
import { createMockAsk } from '../public/shared/mock.js';
import { rng, hash32 } from '../public/shared/rng.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(here, '..', '.env.local');
if (fs.existsSync(envFile)) { for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim()); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]; } }
const args = process.argv.slice(2);
const option = (n) => { const at = args.indexOf(`--${n}`); return at >= 0 ? args[at + 1] : undefined; };
const presetId = option('preset') ?? 'listing';
const text = args.filter((a, i) => !a.startsWith('--') && !['preset'].includes((args[i - 1] ?? '').replace(/^--/, ''))).join(' ').trim();
const picked = pickProvider(process.env);
const real = args.includes('--real') && Boolean(picked);
const send = real ? (r) => askJev(picked, r) : createMockAsk();
const people = crowd('zh');
const market = ['listing', 'product'].includes(presetId);
const ids = groupsOf(market).map(([id]) => id);

const out = await send(openingRequest(presetId, text));
const scores = openingAnswers(out.answers).scores;
console.log(`\n【${presetId}】${text} · ${real ? `真实 ${picked.name}` : 'mock'} · $${out.usd.toFixed(4)}`);

const ranks = people.map((who, i) => ({ id: who.id, e: exposure(who, scores, presetId) }));
const sorted = [...ranks].sort((a, b) => b.e - a.e);
const total = sorted.reduce((s, x) => s + x.e, 0) || 1;
// 有效人数：exposure 当权重。完全平 = 10000。
let sq = 0; for (const x of sorted) sq += (x.e / total) ** 2;
console.log(`\nexposure：最高 ${sorted[0].e.toFixed(3)} · 中位 ${sorted[Math.floor(sorted.length / 2)].e.toFixed(3)} · 最低 ${sorted.at(-1).e.toFixed(3)}`);
console.log(`有效人数 ${(1 / sq).toFixed(0)} / ${people.length} —— 第 1 波不是随机抽的，是从这个形状的最尖上挑的`);

const random = rng(hash32('waves', 'zh', `probe.${hash32(presetId, text)}`));
const wave1 = firstWave(people, scores, presetId, random);
const inWave = new Set(wave1.map((w) => w.id));
console.log(`第 1 波 ${wave1.length} 人 · 落在 exposure 前 ${(sorted.findIndex((x) => !inWave.has(x.id)) + wave1.length)} 名之内`);

// 形状是「属性组合」还是「一整组」？看同一个兴趣的人 vs 不同兴趣的人各自的 exposure。
const SEGMENTS = { interest: (w) => w.interests, field: (w) => [w.field], age: (w) => [w.ageGroup], budget: (w) => [w.budget], shopping: (w) => (w.shopping === 'nothing' ? [] : [w.shopping]) };
const members = new Map(ids.map((id) => [id, []]));
people.forEach((w, i) => { for (const [a, f] of Object.entries(SEGMENTS)) for (const v of f(w)) members.get(`${a}:${v}`)?.push(i); });
const shareIn = (list) => list.filter((i) => inWave.has(people[i].id)).length / wave1.length;
const rows = ids.map((id) => {
  const m = members.get(id) ?? []; if (!m.length) return null;
  const sh = shareIn(m); const base = m.length / people.length;
  return { id, score: scores[id] ?? 0, size: m.length, share: sh, lift: base ? sh / base : 0, e: m.reduce((s, i) => s + ranks[i].e, 0) / m.length };
}).filter(Boolean).sort((a, b) => b.score - a.score);
console.log(`\n按 Jev 打分排（前 12 组非零）：`);
for (const r of rows.filter((x) => x.score > 0).slice(0, 12)) console.log(`  ${r.id.padEnd(24)} 分 ${r.score.toFixed(2)} · ${String(r.size).padStart(4)} 人 · 第 1 波占 ${(r.share * 100).toFixed(1)}% · ${r.lift.toFixed(2)}× · 组内均值 exposure ${r.e.toFixed(3)}`);
console.log(`\n打分最高的组和第 1 波超配最高的组一致吗？`);
const byScore = rows.filter((r) => r.score > 0).slice(0, 12).map((r) => r.id);
const byLift = [...rows].sort((a, b) => b.lift - a.lift).slice(0, 12).map((r) => r.id);
console.log(`  按打分前 12：${byScore.join(' ')}`);
console.log(`  按超配前 12：${byLift.join(' ')}`);
console.log(`  重合 ${byScore.filter((id) => byLift.includes(id)).length} / 12`);
