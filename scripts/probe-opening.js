// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：Jev 开局那 83 个分组打分，在真实 Jev 上有没有形状。
//
// 为什么问这个：第 1 波那 600 人完全由 exposure（83 组分数折立方、按维度权重求和）排序挑出，
// 也就是「Jev 觉得谁该先看到这段话」。第 2 波往后才是被传播牵动的。所以如果这 83 个分数在真实
// Jev 上几乎是平的，第 1 波就等于随机抽 600 人，报告里一切关于「谁先看到」的话都是假的。
// 这个数从没被量过——docs/research/wave-baseline-report.md 量的是波次情绪，不是开局打分。
//
// 用法：node scripts/probe-opening.js --real --rounds 2 --preset listing "文本"
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
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const VALUE_FLAGS = new Set(['preset', 'rounds']);
const presetId = option('preset') ?? 'listing';
const text = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has((args[i - 1] ?? '').replace(/^--/, ''))).join(' ').trim();
if (!text) { console.error('用法：node scripts/probe-opening.js [--real] [--rounds 2] --preset listing "文本"'); process.exit(1); }
const picked = pickProvider(process.env);
const real = args.includes('--real') && Boolean(picked);
if (args.includes('--real') && !picked) console.error('没有 key，退回 mock');
const send = real ? (request) => askJev(picked, request) : createMockAsk();

const people = crowd('zh');
const market = ['listing', 'product'].includes(presetId);
const ids = groupsOf(market).map(([id]) => id);

let usd = 0; let tokens = 0; let requests = 0;
const rounds = Number(option('rounds') ?? 1);
const readings = [];
for (let r = 0; r < rounds; r++) {
  const result = await send(openingRequest(presetId, text));
  usd += result.usd; tokens += result.tokens; requests += 1;
  readings.push(openingAnswers(result.answers).scores);
}
const scores = readings[0];

console.log(`\n【${presetId}】${text}`);
console.log(`通道：${real ? `真实 ${picked.name}` : 'mock'} · 词表 ${ids.length} 组 · 复读 ${rounds} 遍`);

const sorted = ids.map((id) => [id, scores[id] ?? 0]).sort((a, b) => b[1] - a[1]);
const spread = sorted[0][1] - sorted.at(-1)[1];
const mean = sorted.reduce((s, x) => s + x[1], 0) / sorted.length;
const avg = (list) => list.reduce((s, x) => s + x[1], 0) / list.length;
console.log(`\n分数：最高 ${sorted[0][1].toFixed(3)}（${sorted[0][0]}） · 最低 ${sorted.at(-1)[1].toFixed(3)} · 中位 ${sorted[Math.floor(ids.length / 2)][1].toFixed(3)} · 均值 ${mean.toFixed(3)}`);
console.log(`极差 ${spread.toFixed(3)} · 前 10 组均值 ${avg(sorted.slice(0, 10)).toFixed(3)} · 后 10 组均值 ${avg(sorted.slice(-10)).toFixed(3)}`);
let noise = null;
if (rounds > 1) {
  let diff = 0; let worst = 0;
  for (const id of ids) { const d = Math.abs(scores[id] - readings[1][id]); diff += d; if (d > worst) worst = d; }
  noise = diff / ids.length;
  console.log(`复读噪声：平均绝对差 ${noise.toFixed(4)} · 最大 ${worst.toFixed(4)} → 相当于极差的 ${((noise / (spread || 1)) * 100).toFixed(0)}%`);
}
console.log(`前 12 组：${sorted.slice(0, 12).map(([id, v]) => `${id} ${v.toFixed(2)}`).join(' · ')}`);
console.log(`后 6 组：  ${sorted.slice(-6).map(([id, v]) => `${id} ${v.toFixed(2)}`).join(' · ')}`);

// exposure 的形状：第 1 波 600 人是从哪一截里挑出来的
const versionId = `probe.${hash32(presetId, text)}`;
const wave1 = firstWave(people, scores, presetId, rng(hash32('waves', 'zh', versionId)));
const ranks = people.map((who) => exposure(who, scores, presetId));
const total = ranks.reduce((a, b) => a + b, 0) || 1;
const inWave = new Set(wave1.map((who) => who.id));
const held = people.reduce((sum, who, i) => sum + (inWave.has(who.id) ? ranks[i] : 0), 0);
let sq = 0; for (const v of ranks) sq += (v / total) ** 2;
console.log(`\n第 1 波 ${wave1.length} 人拿走了全城 exposure 的 ${((held / total) * 100).toFixed(1)}%（随机 600 人期望 ${(wave1.length / people.length * 100).toFixed(1)}%）`);
console.log(`exposure 集中度：有效人数 ${(1 / sq).toFixed(0)} / ${people.length}（越小越尖；完全平就是 ${people.length}）`);

// 逐组对账：Jev 给这组打了高分的组，第 1 波里占了几成（相对全城放大了几倍）
const SEGMENTS = {
  interest: (who) => who.interests,
  field: (who) => [who.field],
  age: (who) => [who.ageGroup],
  budget: (who) => [who.budget],
  shopping: (who) => (who.shopping === 'nothing' ? [] : [who.shopping]),
};
const members = new Map(ids.map((id) => [id, []]));
people.forEach((who, i) => {
  for (const [attribute, valuesOf] of Object.entries(SEGMENTS)) {
    for (const value of valuesOf(who)) members.get(`${attribute}:${value}`)?.push(i);
  }
});
const rows = ids.map((id) => {
  const who = members.get(id) ?? [];
  if (!who.length) return null;
  const share = who.filter((i) => inWave.has(people[i].id)).length / wave1.length;
  return { id, score: scores[id] ?? 0, size: who.length, share, lift: share / (who.length / people.length) };
}).filter(Boolean).sort((a, b) => b.score - a.score);
const top = rows.filter((r) => r.score > 0).slice(0, 10);
console.log(`\n打分非零的组里，第 1 波超配最厉害的 10 个（lift = 第 1 波占比 ÷ 全城占比）：`);
for (const r of top) console.log(`  ${r.id.padEnd(24)} 分 ${r.score.toFixed(2)} · ${String(r.size).padStart(4)} 人 · 第 1 波 ${(r.share * 100).toFixed(1)}% · ${r.lift.toFixed(2)}×`);
const lifted = rows.filter((r) => r.score > 0);
console.log(`\n所有非零组里被超配的（lift>1）${lifted.filter((r) => r.lift > 1).length} / ${lifted.length} 个 · 最高 lift ${Math.max(...lifted.map((r) => r.lift)).toFixed(2)}×`);
console.log(`花费 $${usd.toFixed(4)} · tokens ${tokens} · 请求 ${requests} 次`);
