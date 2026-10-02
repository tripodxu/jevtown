// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：Jev 开局那份打分是不是一份预测，
// 而且预测得准不准。
//
// 背景：第 1 波 600 人完全按 exposure 排序挑出。exposure = Jev 开局那 83 组分数的折立方和，
// 也就是「Jev 说谁该先看到这段话」——一份在任何人有反应之前就已经做好的预测。
//
// 问的是：这份预测有没有兑现？把一万格按 exposure 从高到低分十档，每档的实际停下率与乐见率
// 分别是多少。若第 1 档明显强于第 10 档，Jev 开局就押对了人，报告里可以把它当读数说；
// 若各档差不多，exposure 只是一把排序的尺子，不该被当成「谁在乎」的证据。
//
// 用法：node scripts/probe-calibration.js [--real] --preset listing "文本" [存档.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowd } from '../public/shared/personas.js';
import { PRESETS } from '../public/shared/presets.js';
import { openingRequest, openingAnswers } from '../public/shared/requests.js';
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
const presetId = option('preset') ?? 'listing';
const rest = args.filter((arg, index) => !arg.startsWith('--') && arg !== 'preset' && (args[index - 1] ?? '') !== '--preset');
const archiveAt = rest.findIndex((arg) => arg.endsWith('.json'));
const archive = archiveAt >= 0 ? rest[archiveAt] : null;
const text = archive ? null : rest.join(' ').trim();

const picked = pickProvider(process.env);
const send = args.includes('--real') && picked ? (request) => askJev(picked, request) : createMockAsk();
const saved = archive ? JSON.parse(fs.readFileSync(archive, 'utf8')) : null;
const presetId2 = saved ? saved.presetId : presetId;
const body = saved ? saved.text : text;
if (!body) {
  console.error('用法：node scripts/probe-calibration.js [--real] --preset listing "文本" [存档.json]');
  process.exit(1);
}
const people = crowd(saved ? (saved.pool ?? 'zh') : 'zh');
const reactionsOf = PRESETS[presetId2].reactions;

const out = await send(openingRequest(presetId2, body));
const scores = openingAnswers(out.answers).scores;
console.log(`\n【${presetId2}】${body}`);
console.log(`scores：${args.includes('--real') ? `真实 ${picked.name}` : 'mock'} · $${out.usd.toFixed(4)} · ${Object.keys(scores).length} 组`);
console.log(`reactions：${archive ?? '无（本次只量排序）'}`);

const order = people
  .map((who, index) => ({ id: who.id, index, e: exposure(who, scores, presetId2) }))
  .sort((a, b) => b.e - a.e || a.id - b.id);
const per = Math.floor(order.length / 10);
const bandOf = new Map(order.map((row, at) => [row.id, Math.min(9, Math.floor(at / per))]));
console.log(`\nexposure 十分档（每档 ${per} 人）：档 1 = 最该先看到的`);

if (!saved) {
  for (let d = 0; d < 10; d++) {
    const band = order.slice(d * per, (d + 1) * per);
    console.log(`  ${d + 1} 档  ${band[0].e.toFixed(3)}–${band.at(-1).e.toFixed(3)}`);
  }
  console.log('\n没给 reactions 存档，这一档只能看排序；要停下率请在末尾给一个 .json 存档。');
  process.exit(0);
}

const bytes = Uint8Array.from(saved.reactions);
const keys = saved.keys ?? Object.keys(reactionsOf);
const toneOf = (byte) => (byte ? (reactionsOf[keys[byte - 1]]?.tone ?? 0) : null);
const stoppedOf = (byte) => Boolean(byte && reactionsOf[keys[byte - 1]]?.stopped);

const seen = order.filter((row) => bytes[row.index]);
const baseStop = seen.filter((row) => stoppedOf(bytes[row.index])).length / Math.max(1, seen.length);
const baseGlad = seen.filter((row) => toneOf(bytes[row.index]) === 1).length / Math.max(1, seen.length);
console.log(`全城：到达 ${seen.length.toLocaleString()} 人 · 停下率 ${(baseStop * 100).toFixed(1)}% · 乐见率 ${(baseGlad * 100).toFixed(1)}%\n`);
console.log('  档   exposure 区间     到达   停下率   停下 lift   乐见率   乐见 lift');
const rates = [];
for (let d = 0; d < 10; d++) {
  const band = order.slice(d * per, (d + 1) * per);
  const reached = band.filter((row) => bytes[row.index]);
  const stopRate = reached.filter((row) => stoppedOf(bytes[row.index])).length / Math.max(1, reached.length);
  const gladRate = reached.filter((row) => toneOf(bytes[row.index]) === 1).length / Math.max(1, reached.length);
  rates.push({ d, stopRate, gladRate });
  console.log(`  ${String(d + 1).padStart(2)}  ${band[0].e.toFixed(3)}–${band.at(-1).e.toFixed(3)}  ${String(reached.length).padStart(5)}  ${(stopRate * 100).toFixed(1).padStart(6)}%  ${(stopRate / (baseStop || 1)).toFixed(2).padStart(8)}×  ${(gladRate * 100).toFixed(1).padStart(6)}%  ${(gladRate / (baseGlad || 1)).toFixed(2).padStart(8)}×`);
}
const top = rates[0];
const bottom = rates[9];
console.log(`\n停下率：第 1 档 ${(top.stopRate * 100).toFixed(1)}% vs 第 10 档 ${(bottom.stopRate * 100).toFixed(1)}% → ${(top.stopRate / Math.max(1e-9, bottom.stopRate)).toFixed(2)} 倍`);
console.log(`乐见率：第 1 档 ${(top.gladRate * 100).toFixed(1)}% vs 第 10 档 ${(bottom.gladRate * 100).toFixed(1)}% → ${(top.gladRate / Math.max(1e-9, bottom.gladRate)).toFixed(2)} 倍`);

const versionId = saved.versionId ?? `probe.${hash32(presetId2, body)}`;
const wave1 = firstWave(people, scores, presetId2, rng(hash32('waves', 'zh', versionId)));
const inWave = new Set(wave1.map((who) => who.id));
const spread = Array(10).fill(0);
for (const row of wave1) spread[bandOf.get(row.id)] += 1;
console.log(`\n第 1 波 ${wave1.length} 人落在十档里：${spread.map((n, d) => (n ? `${d + 1}档 ${n} 人` : null)).filter(Boolean).join(' · ')}`);
console.log(`（前 ${spread[0] + spread[1] + spread[2]} 档共 ${spread[0] + spread[1] + spread[2]} 人 = ${((spread[0] + spread[1] + spread[2]) / wave1.length * 100).toFixed(0)}%）`);
