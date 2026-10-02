// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：Jev 开局那份打分能不能兑现？
//
// exposure（feed.js）是第 1 波 600 人的唯一排序依据，它是 Jev 开局那 83 组 CARE 分数的折立方和，
// 也就是「Jev 说谁该先看到这段话」——**这是整个产品里唯一一个在任何人有反应之前就做好的预测**。
// 报告展示了 Jev 说的每句话和之后发生的每一件事，唯独这份预测从没被拿去和结果对账。
//
// 三条 arm 各 n 人，问 Jev 完全相同的一道题，只有「挑谁」不同：
//   A 尖：exposure 最高的 n 人（Jev 说最该先看到的）
//   B 底：exposure 最低的 n 人（Jev 说最不该看到的）
//   C 随机：从**去掉尖和底之后**的人里随机抽 n 人
// 三臂必须互斥且臂内不重复，否则对照废了（第一版臂间撞人、第二版臂内重复抽到同一人）。
// A 与 C 的差 = Jev 开局的判断比随机强多少；B 是这条判断的反面。
//
// 用法：node scripts/probe-openpick.js --real --n 200 --preset listing "文本"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowd } from '../public/shared/personas.js';
import { PRESETS } from '../public/shared/presets.js';
import { reactionRequest, openingRequest, openingAnswers } from '../public/shared/requests.js';
import { exposure, mood, firstWave } from '../public/shared/feed.js';
import { drawReaction } from '../public/shared/draw.js';
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
const n = Number(option('n') ?? 200);
const scoresRounds = Number(option('scores-rounds') ?? 1);
const text = args
  .filter((arg, index) => !arg.startsWith('--') && !['preset', 'n', 'scores-rounds'].includes((args[index - 1] ?? '').replace(/^--/, '')))
  .join(' ')
  .trim();
if (!text) {
  console.error('用法：node scripts/probe-openpick.js [--real] [--n 200] --preset listing "文本"');
  process.exit(1);
}
const picked = pickProvider(process.env);
const real = args.includes('--real') && Boolean(picked);
if (args.includes('--real') && !picked) console.error('没有 key，退回 mock');
const send = real ? (request) => askJev(picked, request) : createMockAsk();

const people = crowd('zh');
const preset = PRESETS[presetId];
const versionId = `probe.${hash32(presetId, text)}`;
let usd = 0;
let tokens = 0;
let requests = 0;

// 开局那一次（scores）——本实验的自变量，多复读几遍取均值，压掉复读噪声。
const scores = {};
for (let r = 0; r < scoresRounds; r++) {
  const out = await send(openingRequest(presetId, text));
  usd += out.usd; tokens += out.tokens; requests += 1;
  const parsed = openingAnswers(out.answers).scores;
  for (const [id, value] of Object.entries(parsed)) {
    scores[id] = scores[id] === undefined ? value : (scores[id] + value) / 2;
  }
}

const ranked = people.map((who) => ({ who, e: exposure(who, scores, presetId) })).sort((a, b) => b.e - a.e || a.who.id - b.who.id);
const topE = ranked[0].e;
const bottomE = ranked.at(-1).e;
// 随机臂：从去掉尖和底的人里洗牌取 n（不放回）——放回会抽到同一个人，两臂就不独立了。
const middle = ranked.slice(n, ranked.length - n).map((row) => row.who);
const pool = [...middle];
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rng(hash32('openpick', presetId, text, String(i)))() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const arms = [
  { key: 'A', name: 'Jev 说最该先看到', people: ranked.slice(0, n).map((row) => row.who) },
  { key: 'C', name: '随机', people: pool.slice(0, n) },
  { key: 'B', name: 'Jev 说最不该看到', people: ranked.slice(-n).map((row) => row.who) },
];
const seenIds = new Set();
for (const arm of arms) {
  if (arm.people.length !== n) throw new Error(`臂 ${arm.key} 只有 ${arm.people.length} 人，要 ${n} 人`);
  for (const who of arm.people) {
    if (seenIds.has(who.id)) throw new Error(`两臂撞上同一个人 ${who.id}——对照的三臂必须互斥且不放回`);
    seenIds.add(who.id);
  }
}

console.log(`\n【${presetId}】${text}`);
console.log(`通道：${real ? `真实 ${picked.name}` : 'mock'} · 每臂 ${n} 人 · scores 复读 ${scoresRounds} 遍 · exposure ${bottomE.toFixed(3)}–${topE.toFixed(3)}`);

const rows = [];
for (const arm of arms) {
  const drawn = [];
  for (let at = 0; at < arm.people.length; at += 100) {
    const batch = arm.people.slice(at, at + 100);
    const out = await send(reactionRequest(presetId, text, batch));
    usd += out.usd; tokens += out.tokens; requests += 1;
    for (const who of batch) {
      const probabilities = out.answers[`p${who.id}`]?.probabilities ?? {};
      drawn.push(drawReaction(probabilities, 'zh', who.id, versionId) ?? 'cant_tell');
    }
  }
  // 计数与比例一起留：比例是给人看的，计数才是真的——对面 0/200 时任何比值都是显示假象。
  const tally = (test) => {
    const hits = drawn.filter((r) => test(preset.reactions[r] ?? {})).length;
    return { hits, rate: hits / Math.max(1, drawn.length) };
  };
  const stop = tally((r) => r.stopped);
  const glad = tally((r) => r.tone === 1);
  const sorry = tally((r) => r.tone === -1);
  const hollow = tally((r) => r.hollow);
  const spread = tally((r) => r.spreads);
  rows.push({
    ...arm,
    mood: mood(presetId, drawn),
    meanE: arm.people.reduce((sum, who) => sum + exposure(who, scores, presetId), 0) / arm.people.length,
    stop: stop.rate, stopHits: stop.hits,
    glad: glad.rate, gladHits: glad.hits,
    sorry: sorry.rate, sorryHits: sorry.hits,
    hollow: hollow.rate, hollowHits: hollow.hits,
    spread: spread.rate, spreadHits: spread.hits,
  });
}
console.log('\n臂   人群              exposure均值    情绪    停下(命中/200)   乐见(命中/200)   反感   拿不准   转传');
for (const row of rows) {
  console.log(`  ${row.key} ${row.name.padEnd(10)} ${row.meanE.toFixed(3).padStart(12)}  ${row.mood.toFixed(3).padStart(7)}  ${String(row.stopHits).padStart(4)} (${(row.stop * 100).toFixed(0).padStart(3)}%)  ${String(row.gladHits).padStart(4)} (${(row.glad * 100).toFixed(0).padStart(3)}%)  ${String(row.sorryHits).padStart(3)}  ${String(row.hollowHits).padStart(4)}  ${String(row.spreadHits).padStart(3)}`);
}
const [a, c, b] = ['A', 'C', 'B'].map((key) => rows.find((row) => row.key === key));
// 比值只在两边都有命中时给；对面 0/200 就说「对面一个都没有」，不拿 epsilon 编出一个数。
const ratio = (topHits, bottomHits, n, label) => (bottomHits
  ? `${label} ${(topHits / bottomHits).toFixed(2)}×（${topHits} 对 ${bottomHits}）`
  : `${label} 对面 ${bottomHits}/${n}——没有比值可给`);
console.log(`\n情绪 A − C ${(a.mood - c.mood).toFixed(3)} · A − B ${(a.mood - b.mood).toFixed(3)}`);
console.log(`${ratio(a.stopHits, c.stopHits, n, '停下率 A/C')} · ${ratio(a.stopHits, b.stopHits, n, 'A/B')}`);
console.log(`${ratio(a.gladHits, c.gladHits, n, '乐见率 A/C')} · ${ratio(a.gladHits, b.gladHits, n, 'A/B')}`);
console.log(`${ratio(a.spreadHits, c.spreadHits, n, '转传率 A/C')} · 反感 ${a.sorryHits}/${b.sorryHits} · 拿不准 ${a.hollowHits}/${b.hollowHits}`);

const wave1 = firstWave(people, scores, presetId, rng(hash32('waves', 'zh', versionId)));
const waveMean = wave1.reduce((sum, who) => sum + exposure(who, scores, presetId), 0) / wave1.length;
console.log(`\n真第 1 波 ${wave1.length} 人 · exposure 均值 ${waveMean.toFixed(3)}（A ${a.meanE.toFixed(3)} / C ${c.meanE.toFixed(3)} / B ${b.meanE.toFixed(3)}）`);
console.log(`\n花费 $${usd.toFixed(4)} · tokens ${tokens} · 请求 ${requests} 次`);
