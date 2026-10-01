// 一次性探针（scripts/ 是 CLI，console.log 豁免 lint）：真实 Jev 与纯随机差在哪。
//
// 三条 arm 跑同一批波、同一种子随机，只有"怎么决定每个人的反应"不同：
//   A 真实 Jev：每人的反应从 Jev 给他的概率分布里抽——站点现在的做法。
//   B 纯随机  ：不看人、不看帖，在反应表里均匀随机抽——不花钱，因为随机不需要问任何人。
//   C 洗掉形状：每人的概率换成全波的平均分布——还是问 Jev（要钱），但抹掉人与人的差别。
//
// A vs B = 问 Jev 比纯随机强在哪；A vs C = 这点优势来自"人与人的差别"还是"Jev 的整体判断"。
// 答案问一次就存下来（answerOf），三条 arm 共用同一份——钱只花一遍，对照才公平。
//
// 用法：node scripts/probe-waves.js --preset listing "文本"           （默认 mock，零花费）
//       node scripts/probe-waves.js --real --only A --preset listing "文本"  （只跑 A，省钱）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crowd } from '../public/shared/personas.js';
import { PRESETS, CANT_TELL } from '../public/shared/presets.js';
import { firstWave, nextWave, mood, travels, GLAD_ENOUGH, WAVES } from '../public/shared/feed.js';
import { reactionRequest, openingRequest, openingAnswers } from '../public/shared/requests.js';
import { drawReaction, expectedTone } from '../public/shared/draw.js';
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
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const VALUE_FLAGS = new Set(['preset', 'max-waves', 'only']);
const positional = args
  .filter((arg, index) => !arg.startsWith('--') && !VALUE_FLAGS.has((args[index - 1] ?? '').replace(/^--/, '')))
  .join(' ')
  .trim();
const presetId = option('preset') ?? 'listing';
const maxWaves = Number(option('max-waves') ?? WAVES.length);
if (!PRESETS[presetId]) {
  console.error(`unknown preset: ${presetId}（可选：post / listing / product / headline）`);
  process.exit(1);
}
if (!positional) {
  console.error('用法：node scripts/probe-waves.js --preset listing "文本" [--real] [--only A]');
  process.exit(1);
}
const text = positional;
const only = (option('only') ?? '').toUpperCase().split('').filter(Boolean);
if (only.some((key) => !'ABC'.includes(key))) {
  console.error('--only 只接受 A / B / C，可以写 AC 这样的组合');
  process.exit(1);
}

const picked = pickProvider(process.env);
const real = args.includes('--real') && picked;
if (args.includes('--real') && !picked) console.error('没有 key，退回 mock');
const send = real ? (request) => askJev(picked, request) : createMockAsk();

const people = crowd('zh');
const preset = PRESETS[presetId];
const versionId = `probe.${hash32(presetId, text)}`;
const chunk = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

let usd = 0;
let tokens = 0;
let requests = 0;

// 同一批人只问一次：三条 arm 共用同一份答案，钱只花一遍，对照才公平。
const answerOf = new Map();
async function askOnce(wave) {
  // 缓存命中就不再问——不查缓存等于把同一段文字问三遍。
  const fresh = wave.filter((who) => !answerOf.has(who.id));
  if (!fresh.length) return;
  for (const batch of chunk(fresh, 100)) {
    const result = await send(reactionRequest(presetId, text, batch));
    usd += result.usd;
    tokens += result.tokens;
    requests += 1;
    for (const who of batch) answerOf.set(who.id, result.answers[`p${who.id}`]?.probabilities ?? {});
  }
}

// -- 三条 arm 的「这个人会怎样」 ----------------------------------------------------------------

/** A：Jev 给的概率。 */
const armJev = (who) => answerOf.get(who.id) ?? {};
/** B：纯随机——不看人、不看帖，在反应表里均匀抽一个。 */
const armRandom = (() => {
  const ids = Object.keys(preset.reactions);
  const cache = new Map();
  return (who) => {
    if (!cache.has(who.id)) {
      const at = ids[Math.floor(rng(hash32('rand', versionId, who.id))() * ids.length)];
      cache.set(who.id, { [at]: 1 });
    }
    return cache.get(who.id);
  };
})();
/** C：洗掉形状——每个人拿全波的平均分布：Jev 的整体判断还在，人与人的差别没了。 */
let waveMean = {};
const armWashed = () => waveMean;

/** 全波的平均分布（C arm 用）。 */
function averageOf(wave) {
  const mean = {};
  for (const who of wave) {
    for (const [id, value] of Object.entries(armJev(who))) mean[id] = (mean[id] ?? 0) + value;
  }
  for (const id of Object.keys(mean)) mean[id] /= Math.max(1, wave.length);
  return mean;
}

/**
 * The null model: a coin flip instead of Jev. Under it every reaction is equally likely, so the
 * mood a wave would show by luck is the table's mean tone, and the spread around it is the standard
 * error of the mean. A wave that lands inside ±2 of that is one a die roll could have produced —
 * passing the gate on it means we learned nothing about the text.
 */
const NULL = (() => {
  const tones = Object.values(preset.reactions).map((reaction) => reaction.tone ?? 0);
  const mean = tones.reduce((a, b) => a + b, 0) / tones.length;
  const variance = tones.reduce((sum, tone) => sum + (tone - mean) ** 2, 0) / tones.length;
  return { mean, sd: Math.sqrt(variance) };
})();
const zOf = (value, n) => (value - NULL.mean) / (NULL.sd / Math.sqrt(Math.max(1, n)));

/** 一波在一条 arm 上的读数。 */
function readWave(wave, of) {
  const drawn = [];
  let expected = 0;
  let hollow = 0;
  let stopped = 0;
  let spread = 0;
  let stoppedNet = 0;
  for (const who of wave) {
    const p = of(who);
    const reaction = drawReaction(p, 'zh', who.id, versionId);
    drawn.push(reaction);
    if (reaction === CANT_TELL) hollow += 1;
    expected += expectedTone(presetId, p);
    const definition = preset.reactions[reaction] ?? {};
    if (definition.stopped) {
      stopped += 1;
      stoppedNet += definition.tone ?? 0;
    }
    if (definition.spreads) spread += 1;
  }
  const n = Math.max(1, drawn.length);
  const value = mood(presetId, drawn);
  return {
    drawn,
    mood: value,
    expected: expected / n,
    hollow: hollow / n,
    stopped: stopped / n,
    spread: spread / n,
    gladAmongStopped: stopped ? stoppedNet / stopped : 0,
    z: zOf(value, drawn.length),
  };
}

/** 跑完一条 arm：波次照常，但每波取反应的方式不同。 */
async function runArm(name, of) {
  const random = rng(hash32('waves', 'zh', versionId)); // 三条 arm 同一颗种子 → 同一批波
  const reached = new Map();
  let wave = firstWave(people, openingScores, presetId, random);
  const history = [];
  for (let index = 0; index < maxWaves && wave.length; index++) {
    await askOnce(wave);
    waveMean = averageOf(wave);
    const info = readWave(wave, of);
    history.push({ index: index + 1, asked: wave.length, ...info });
    for (const [i, who] of wave.entries()) reached.set(who.id, info.drawn[i]);
    if (!travels(presetId, info.drawn)) break;
    wave = nextWave(people, reached, openingScores, presetId, index + 1, random);
  }
  return { name, reached: reached.size, waves: history.length, history };
}

// -- 开局：无论真 mock 都要问，因为首波是谁靠这些 exposure 分排出来 ------------------------------
const opening = await (async () => {
  const result = await send(openingRequest(presetId, text));
  usd += result.usd;
  tokens += result.tokens;
  requests += 1;
  return openingAnswers(result.answers);
})();
const openingScores = opening.scores;

console.log(`【${presetId}】${text.slice(0, 60)}${text.length > 60 ? '…' : ''}`);
console.log(`通道：${real ? `真实 ${picked.name}` : 'mock'} · 阈值 GLAD_ENOUGH = ${GLAD_ENOUGH}`);
// 随机基线：均匀抽反应时的情绪期望，就是这条线。mood 落在它附近 = 这一波没说明什么。
console.log(`随机基线：情绪 ${NULL.mean >= 0 ? '+' : ''}${NULL.mean.toFixed(3)} ± ${NULL.sd.toFixed(3)}（每波标准误 ${(NULL.sd / Math.sqrt(600)).toFixed(3)} @600 人）`);
if (opening.blocked.length) {
  console.log(`审核拒绝：${opening.blocked.join(', ')}`);
  process.exit(0);
}

const ARMS = { A: ['A 真实 Jev', armJev], B: ['B 纯随机', armRandom], C: ['C 洗掉形状', armWashed] };
const arms = [];
for (const key of (only.length ? only : ['A', 'B', 'C'])) {
  const [name, of] = ARMS[key];
  arms.push(await runArm(name, of));
}

// -- 打表 --------------------------------------------------------------------------------------
for (const arm of arms) {
  console.log(`\n【${arm.name}】到达 ${arm.reached} 人 · ${arm.waves} 波`);
  for (const wave of arm.history) {
    const tally = {};
    for (const reaction of wave.drawn) tally[reaction] = (tally[reaction] ?? 0) + 1;
    const top = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, n]) => `${id} ${n}`)
      .join(' ');
    const sign = (n) => (n >= 0 ? '+' : '');
    console.log(
      `  第 ${wave.index} 波 ${wave.asked} 人：情绪 ${sign(wave.mood)}${wave.mood.toFixed(3)}` +
        `（期望 ${sign(wave.expected)}${wave.expected.toFixed(3)}）→ ${travels(presetId, wave.drawn) ? '继续' : '停'} · ` +
        `z ${sign(wave.z)}${wave.z.toFixed(2)} · 停住 ${(wave.stopped * 100).toFixed(0)}%` +
        `（其中乐见 ${sign(wave.gladAmongStopped)}${wave.gladAmongStopped.toFixed(2)}）· 转传 ${(wave.spread * 100).toFixed(0)}% · ` +
        `拿不准 ${(wave.hollow * 100).toFixed(0)}% · ${top}`,
    );
  }
}

if (arms.length === 3) {
  const [a, b, c] = arms;
  const row = (label, value) => console.log(`  ${label}  ${value}`);
  console.log(`\n对照（A 真实 Jev / B 纯随机 / C 洗掉形状）`);
  row('到达人数：', `${a.reached} / ${b.reached} / ${c.reached}`);
  row('波数：', `${a.waves} / ${b.waves} / ${c.waves}`);
  const first = (arm, pick) => arm.history[0][pick].toFixed(3);
  row('第 1 波情绪：', `${first(a, 'mood')} / ${first(b, 'mood')} / ${first(c, 'mood')}（随机基线 ${NULL.mean.toFixed(3)}）`);
  const pct = (arm, pick) => `${(arm.history[0][pick] * 100).toFixed(0)}%`;
  row('拿不准率：', `${pct(a, 'hollow')} / ${pct(b, 'hollow')} / ${pct(c, 'hollow')}`);
  row('停住率：', `${pct(a, 'stopped')} / ${pct(b, 'stopped')} / ${pct(c, 'stopped')}`);
  row('停住者里乐见：', `${a.history[0].gladAmongStopped.toFixed(2)} / ${b.history[0].gladAmongStopped.toFixed(2)} / ${c.history[0].gladAmongStopped.toFixed(2)}`);
  row('转传率：', `${pct(a, 'spread')} / ${pct(b, 'spread')} / ${pct(c, 'spread')}`);
}
console.log(`花费 $${usd.toFixed(4)} · tokens ${tokens} · 请求 ${requests} 次（问一次各 arm 共用）`);
